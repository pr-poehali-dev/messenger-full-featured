import json
import os
import random
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

import psycopg2


CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
}


def handler(event: dict, context) -> dict:
    """Авторизация через Telegram-бот: отправка кода и его проверка.
    action=send   — генерирует 4-значный код и отправляет его пользователю в Telegram.
    action=verify — проверяет код, создаёт/обновляет пользователя, возвращает данные.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Method not allowed'})

    body = json.loads(event.get('body') or '{}')
    action = body.get('action')
    raw_username = str(body.get('username', '')).strip().lstrip('@').lower()

    if not raw_username:
        return _resp(400, {'error': 'Укажите ваш Telegram @username'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    try:
        if action == 'send':
            code = str(random.randint(1000, 9999))
            expires = datetime.utcnow() + timedelta(minutes=10)

            cur.execute("DELETE FROM phone_codes WHERE tg_username = %s", (raw_username,))
            cur.execute(
                "INSERT INTO phone_codes (phone, code, expires_at, tg_username) VALUES (%s, %s, %s, %s)",
                (raw_username, code, expires, raw_username),
            )

            sent = _send_tg(raw_username, code)
            result = {'success': True, 'sent': sent}
            if not sent:
                result['debug_code'] = code
            return _resp(200, result)

        if action == 'verify':
            input_code = str(body.get('code', '')).strip()
            cur.execute(
                "SELECT id, code, attempts, expires_at FROM phone_codes WHERE tg_username = %s ORDER BY id DESC LIMIT 1",
                (raw_username,),
            )
            row = cur.fetchone()
            if not row:
                return _resp(400, {'error': 'Код не найден. Запросите новый.'})

            code_id, real_code, attempts, expires_at = row
            if datetime.utcnow() > expires_at:
                return _resp(400, {'error': 'Срок действия кода истёк (10 мин)'})
            if attempts >= 5:
                return _resp(400, {'error': 'Слишком много попыток. Запросите новый код.'})
            if input_code != real_code:
                cur.execute("UPDATE phone_codes SET attempts = attempts + 1 WHERE id = %s", (code_id,))
                return _resp(400, {'error': 'Неверный код'})

            cur.execute("DELETE FROM phone_codes WHERE tg_username = %s", (raw_username,))
            cur.execute(
                """INSERT INTO users (phone, tg_username)
                   VALUES (%s, %s)
                   ON CONFLICT (phone) DO UPDATE SET tg_username = EXCLUDED.tg_username
                   RETURNING id, name, tg_username""",
                (raw_username, raw_username),
            )
            user_id, name, tg_username = cur.fetchone()
            return _resp(200, {
                'success': True,
                'user': {'id': user_id, 'name': name, 'tg_username': tg_username},
            })

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()


def _send_tg(username: str, code: str) -> bool:
    """Отправляет код в Telegram через getUpdates — ищет chat_id по username."""
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    if not token:
        return False

    chat_id = _get_chat_id(token, username)
    if not chat_id:
        return False

    text = urllib.parse.quote(
        f'🔐 Ваш код для входа в Orbit:\n\n*{code}*\n\nКод действителен 10 минут.',
        safe=''
    )
    url = f'https://api.telegram.org/bot{token}/sendMessage?chat_id={chat_id}&text={text}&parse_mode=Markdown'
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode())
        return data.get('ok', False)
    except Exception:
        return False


def _get_chat_id(token: str, username: str) -> int | None:
    """Ищет chat_id пользователя по username в последних сообщениях боту."""
    url = f'https://api.telegram.org/bot{token}/getUpdates?limit=100&timeout=0'
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode())
        if not data.get('ok'):
            return None
        for update in reversed(data.get('result', [])):
            msg = update.get('message') or update.get('callback_query', {}).get('message')
            if not msg:
                continue
            from_user = update.get('message', {}).get('from') or update.get('callback_query', {}).get('from', {})
            uname = (from_user.get('username') or '').lower()
            if uname == username:
                return from_user.get('id')
    except Exception:
        pass
    return None


def _resp(status: int, payload: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False),
        'isBase64Encoded': False,
    }
