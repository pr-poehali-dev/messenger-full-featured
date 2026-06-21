import json
import os
import random
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

import psycopg2


def handler(event: dict, context) -> dict:
    '''Авторизация по номеру телефона: отправка SMS-кода и его проверка.
    action=send  — генерирует код, шлёт SMS через SMS.RU, сохраняет в БД.
    action=verify — проверяет введённый код, создаёт пользователя, возвращает токен сессии.
    '''
    method = event.get('httpMethod', 'GET')

    cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    }

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': cors, 'body': ''}

    if method != 'POST':
        return {'statusCode': 405, 'headers': {**cors, 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Method not allowed'})}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action')
    phone = ''.join(ch for ch in str(body.get('phone', '')) if ch.isdigit())

    if len(phone) < 11:
        return _resp(400, cors, {'error': 'Некорректный номер телефона'})

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    try:
        if action == 'send':
            code = f'{random.randint(1000, 9999)}'
            expires = datetime.utcnow() + timedelta(minutes=5)
            cur.execute("DELETE FROM phone_codes WHERE phone = %s", (phone,))
            cur.execute(
                "INSERT INTO phone_codes (phone, code, expires_at) VALUES (%s, %s, %s)",
                (phone, code, expires),
            )
            sent = _send_sms(phone, code)
            result = {'success': True, 'sent': sent}
            if not sent:
                result['debug_code'] = code
            return _resp(200, cors, result)

        if action == 'verify':
            input_code = str(body.get('code', '')).strip()
            cur.execute(
                "SELECT id, code, attempts, expires_at FROM phone_codes WHERE phone = %s ORDER BY id DESC LIMIT 1",
                (phone,),
            )
            row = cur.fetchone()
            if not row:
                return _resp(400, cors, {'error': 'Код не найден. Запросите новый.'})

            code_id, real_code, attempts, expires_at = row
            if datetime.utcnow() > expires_at:
                return _resp(400, cors, {'error': 'Срок действия кода истёк'})
            if attempts >= 5:
                return _resp(400, cors, {'error': 'Слишком много попыток. Запросите новый код.'})
            if input_code != real_code:
                cur.execute("UPDATE phone_codes SET attempts = attempts + 1 WHERE id = %s", (code_id,))
                return _resp(400, cors, {'error': 'Неверный код'})

            cur.execute("DELETE FROM phone_codes WHERE phone = %s", (phone,))
            cur.execute(
                "INSERT INTO users (phone) VALUES (%s) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, name",
                (phone,),
            )
            user_id, name = cur.fetchone()
            return _resp(200, cors, {
                'success': True,
                'user': {'id': user_id, 'phone': phone, 'name': name},
            })

        return _resp(400, cors, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()


def _send_sms(phone: str, code: str) -> bool:
    api_id = os.environ.get('SMSRU_API_ID')
    if not api_id:
        return False
    params = urllib.parse.urlencode({
        'api_id': api_id,
        'to': phone,
        'msg': f'Orbit: код подтверждения {code}',
        'json': 1,
    })
    url = f'https://sms.ru/sms/send?{params}'
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode())
        return data.get('status') == 'OK'
    except Exception:
        return False


def _resp(status: int, cors: dict, payload: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {**cors, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False),
        'isBase64Encoded': False,
    }
