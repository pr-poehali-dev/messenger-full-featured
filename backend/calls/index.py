import json
import os
import psycopg2
from datetime import datetime

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
}


def handler(event: dict, context) -> dict:
    """WebRTC сигналинг для звонков: создание, offer/answer, ICE-кандидаты, завершение."""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    method = event.get('httpMethod', 'GET')
    params = event.get('queryStringParameters') or {}
    action = params.get('action') or (json.loads(event.get('body') or '{}').get('action') if method == 'POST' else None)
    user_id_raw = (event.get('headers') or {}).get('x-user-id') or params.get('user_id')

    try:
        user_id = int(user_id_raw) if user_id_raw else None
    except (ValueError, TypeError):
        user_id = None

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    body = json.loads(event.get('body') or '{}') if method == 'POST' else {}

    try:
        # --- Начать звонок (звонящий отправляет offer) ---
        if action == 'initiate' and user_id and method == 'POST':
            callee_id = int(body.get('callee_id'))
            call_type = body.get('call_type', 'audio')
            offer = body.get('offer', '')
            cur.execute(
                """INSERT INTO calls (caller_id, callee_id, status, call_type, offer)
                   VALUES (%s, %s, 'ringing', %s, %s) RETURNING id""",
                (user_id, callee_id, call_type, offer),
            )
            call_id = cur.fetchone()[0]
            return _resp(200, {'call_id': call_id})

        # --- Проверить входящий звонок ---
        if action == 'incoming' and user_id:
            cur.execute(
                """SELECT c.id, c.caller_id, u.tg_username, u.display_name, u.avatar_color,
                          c.call_type, c.offer, c.status
                   FROM calls c JOIN users u ON u.id = c.caller_id
                   WHERE c.callee_id = %s AND c.status = 'ringing'
                   ORDER BY c.created_at DESC LIMIT 1""",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                return _resp(200, {'call': None})
            return _resp(200, {'call': {
                'id': row[0], 'caller_id': row[1],
                'caller_username': row[2], 'caller_name': row[3] or row[2],
                'caller_color': row[4] or 'from-violet-500 to-fuchsia-500',
                'call_type': row[5], 'offer': row[6], 'status': row[7],
            }})

        # --- Ответить (callee отправляет answer) ---
        if action == 'answer' and user_id and method == 'POST':
            call_id = int(body.get('call_id'))
            answer = body.get('answer', '')
            cur.execute(
                "UPDATE calls SET answer = %s, status = 'active' WHERE id = %s AND callee_id = %s",
                (answer, call_id, user_id),
            )
            return _resp(200, {'ok': True})

        # --- Получить answer (для звонящего) ---
        if action == 'get_answer':
            call_id = int(params.get('call_id'))
            cur.execute("SELECT answer, status FROM calls WHERE id = %s", (call_id,))
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Call not found'})
            return _resp(200, {'answer': row[0], 'status': row[1]})

        # --- ICE кандидат ---
        if action == 'ice' and user_id and method == 'POST':
            call_id = int(body.get('call_id'))
            candidate = body.get('candidate', '')
            cur.execute(
                "INSERT INTO ice_candidates (call_id, sender_id, candidate) VALUES (%s, %s, %s)",
                (call_id, user_id, candidate),
            )
            return _resp(200, {'ok': True})

        # --- Получить ICE кандидаты ---
        if action == 'get_ice':
            call_id = int(params.get('call_id'))
            since_id = int(params.get('since_id', 0))
            exclude_sender = int(params.get('exclude_sender', 0))
            cur.execute(
                "SELECT id, candidate FROM ice_candidates WHERE call_id = %s AND id > %s AND sender_id != %s ORDER BY id",
                (call_id, since_id, exclude_sender),
            )
            rows = cur.fetchall()
            return _resp(200, {'candidates': [{'id': r[0], 'candidate': r[1]} for r in rows]})

        # --- Завершить звонок ---
        if action == 'end' and user_id and method == 'POST':
            call_id = int(body.get('call_id'))
            cur.execute(
                "UPDATE calls SET status = 'ended', ended_at = NOW() WHERE id = %s AND (caller_id = %s OR callee_id = %s)",
                (call_id, user_id, user_id),
            )
            return _resp(200, {'ok': True})

        # --- Отклонить звонок ---
        if action == 'reject' and user_id and method == 'POST':
            call_id = int(body.get('call_id'))
            cur.execute(
                "UPDATE calls SET status = 'rejected', ended_at = NOW() WHERE id = %s AND callee_id = %s",
                (call_id, user_id),
            )
            return _resp(200, {'ok': True})

        return _resp(400, {'error': f'Unknown action: {action}'})
    finally:
        cur.close()
        conn.close()


def _resp(status: int, payload: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=str),
    }
