import json
import os
import psycopg2
from datetime import datetime

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
}

COLORS = [
    'from-violet-500 to-fuchsia-500',
    'from-cyan-400 to-blue-500',
    'from-emerald-400 to-teal-500',
    'from-orange-400 to-red-500',
    'from-pink-400 to-rose-500',
    'from-indigo-400 to-purple-500',
    'from-amber-400 to-orange-500',
    'from-green-400 to-emerald-500',
]


def handler(event: dict, context) -> dict:
    """Основной API мессенджера: чаты, сообщения, поиск, каналы."""
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

    try:
        body = json.loads(event.get('body') or '{}') if method == 'POST' else {}

        # --- Поиск людей и каналов ---
        if action == 'search':
            q = params.get('q', '').strip()
            if len(q) < 2:
                return _resp(200, {'users': [], 'channels': []})

            like = f'%{q.lower()}%'
            cur.execute(
                """SELECT id, tg_username, display_name, avatar_color, last_seen
                   FROM users
                   WHERE LOWER(tg_username) LIKE %s OR LOWER(display_name) LIKE %s
                   LIMIT 20""",
                (like, like),
            )
            users = [
                {'id': r[0], 'username': r[1], 'name': r[2] or r[1], 'color': r[3] or COLORS[r[0] % len(COLORS)],
                 'online': _is_online(r[4])}
                for r in cur.fetchall()
            ]
            cur.execute(
                """SELECT id, name, username, description, avatar_color,
                          (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = channels.id) as members
                   FROM channels WHERE is_public = TRUE AND (LOWER(name) LIKE %s OR LOWER(username) LIKE %s)
                   LIMIT 20""",
                (like, like),
            )
            channels = [
                {'id': r[0], 'name': r[1], 'username': r[2], 'description': r[3],
                 'color': r[4] or COLORS[r[0] % len(COLORS)], 'members': r[5]}
                for r in cur.fetchall()
            ]
            return _resp(200, {'users': users, 'channels': channels})

        # --- Список чатов пользователя ---
        if action == 'conversations' and user_id:
            cur.execute(
                """SELECT c.id,
                          CASE WHEN c.user1_id = %s THEN u2.id ELSE u1.id END as partner_id,
                          CASE WHEN c.user1_id = %s THEN u2.tg_username ELSE u1.tg_username END as partner_username,
                          CASE WHEN c.user1_id = %s THEN u2.display_name ELSE u1.display_name END as partner_name,
                          CASE WHEN c.user1_id = %s THEN u2.avatar_color ELSE u1.avatar_color END as partner_color,
                          CASE WHEN c.user1_id = %s THEN u2.last_seen ELSE u1.last_seen END as partner_seen,
                          m.text as last_text,
                          m.created_at as last_time,
                          (SELECT COUNT(*) FROM messages um WHERE um.conversation_id = c.id AND um.sender_id != %s AND um.read_at IS NULL) as unread
                   FROM conversations c
                   JOIN users u1 ON u1.id = c.user1_id
                   JOIN users u2 ON u2.id = c.user2_id
                   LEFT JOIN LATERAL (
                       SELECT text, created_at FROM messages
                       WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
                   ) m ON TRUE
                   WHERE c.user1_id = %s OR c.user2_id = %s
                   ORDER BY m.created_at DESC NULLS LAST""",
                (user_id,) * 9,
            )
            rows = cur.fetchall()
            convs = []
            for r in rows:
                pid = r[1]
                color = r[4] or COLORS[pid % len(COLORS)]
                convs.append({
                    'id': r[0], 'partner_id': pid,
                    'username': r[2], 'name': r[3] or r[2],
                    'color': color, 'online': _is_online(r[5]),
                    'last_text': r[6], 'last_time': _fmt_time(r[7]),
                    'unread': r[8],
                })

            # Каналы пользователя
            cur.execute(
                """SELECT ch.id, ch.name, ch.username, ch.avatar_color,
                          (SELECT text FROM messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_text,
                          (SELECT created_at FROM messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_time,
                          0 as unread
                   FROM channels ch
                   JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = %s
                   ORDER BY last_time DESC NULLS LAST""",
                (user_id,),
            )
            channels = []
            for r in cur.fetchall():
                channels.append({
                    'id': r[0], 'name': r[1], 'username': r[2],
                    'color': r[3] or COLORS[r[0] % len(COLORS)],
                    'is_channel': True, 'last_text': r[4],
                    'last_time': _fmt_time(r[5]), 'unread': 0,
                })
            return _resp(200, {'conversations': convs, 'channels': channels})

        # --- Открыть / создать диалог ---
        if action == 'open_conversation' and user_id:
            partner_id = int(body.get('partner_id'))
            uid1, uid2 = sorted([user_id, partner_id])
            cur.execute(
                "INSERT INTO conversations (user1_id, user2_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING id",
                (uid1, uid2),
            )
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT id FROM conversations WHERE user1_id=%s AND user2_id=%s", (uid1, uid2))
                row = cur.fetchone()
            return _resp(200, {'conversation_id': row[0]})

        # --- Сообщения в диалоге ---
        if action == 'messages':
            conv_id = params.get('conversation_id')
            chan_id = params.get('channel_id')
            offset = int(params.get('offset', 0))

            if conv_id:
                # Помечаем как прочитанные
                if user_id:
                    cur.execute(
                        "UPDATE messages SET read_at = NOW() WHERE conversation_id = %s AND sender_id != %s AND read_at IS NULL",
                        (int(conv_id), user_id),
                    )
                cur.execute(
                    """SELECT m.id, m.sender_id, u.tg_username, u.display_name, u.avatar_color,
                              m.text, m.created_at
                       FROM messages m JOIN users u ON u.id = m.sender_id
                       WHERE m.conversation_id = %s
                       ORDER BY m.created_at DESC LIMIT 50 OFFSET %s""",
                    (int(conv_id), offset),
                )
            elif chan_id:
                cur.execute(
                    """SELECT m.id, m.sender_id, u.tg_username, u.display_name, u.avatar_color,
                              m.text, m.created_at
                       FROM messages m JOIN users u ON u.id = m.sender_id
                       WHERE m.channel_id = %s
                       ORDER BY m.created_at DESC LIMIT 50 OFFSET %s""",
                    (int(chan_id), offset),
                )
            else:
                return _resp(400, {'error': 'need conversation_id or channel_id'})

            msgs = []
            for r in cur.fetchall():
                color = r[4] or COLORS[r[1] % len(COLORS)]
                msgs.append({
                    'id': r[0], 'sender_id': r[1],
                    'username': r[2], 'name': r[3] or r[2],
                    'color': color, 'text': r[5],
                    'time': _fmt_time(r[6]),
                })
            msgs.reverse()
            return _resp(200, {'messages': msgs})

        # --- Отправить сообщение ---
        if action == 'send' and user_id and method == 'POST':
            text = body.get('text', '').strip()
            if not text:
                return _resp(400, {'error': 'Пустое сообщение'})
            conv_id = body.get('conversation_id')
            chan_id = body.get('channel_id')
            if conv_id:
                cur.execute(
                    "INSERT INTO messages (conversation_id, sender_id, text) VALUES (%s, %s, %s) RETURNING id, created_at",
                    (int(conv_id), user_id, text),
                )
            elif chan_id:
                cur.execute(
                    "INSERT INTO messages (channel_id, sender_id, text) VALUES (%s, %s, %s) RETURNING id, created_at",
                    (int(chan_id), user_id, text),
                )
            else:
                return _resp(400, {'error': 'need conversation_id or channel_id'})
            msg_id, created_at = cur.fetchone()
            cur.execute("UPDATE users SET last_seen = NOW() WHERE id = %s", (user_id,))
            return _resp(200, {'id': msg_id, 'time': _fmt_time(created_at)})

        # --- Создать канал ---
        if action == 'create_channel' and user_id and method == 'POST':
            name = body.get('name', '').strip()
            username_ch = body.get('username', '').strip().lower().replace('@', '')
            desc = body.get('description', '').strip()
            if not name:
                return _resp(400, {'error': 'Укажите название'})
            color = COLORS[user_id % len(COLORS)]
            cur.execute(
                "INSERT INTO channels (name, username, description, owner_id, avatar_color) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (name, username_ch or None, desc or None, user_id, color),
            )
            ch_id = cur.fetchone()[0]
            cur.execute("INSERT INTO channel_members (channel_id, user_id, role) VALUES (%s, %s, 'owner')", (ch_id, user_id))
            return _resp(200, {'id': ch_id, 'name': name, 'color': color})

        # --- Вступить в канал ---
        if action == 'join_channel' and user_id and method == 'POST':
            ch_id = int(body.get('channel_id'))
            cur.execute(
                "INSERT INTO channel_members (channel_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (ch_id, user_id),
            )
            return _resp(200, {'ok': True})

        # --- Обновить профиль ---
        if action == 'update_profile' and user_id and method == 'POST':
            name = body.get('display_name', '').strip()
            cur.execute("UPDATE users SET display_name = %s, last_seen = NOW() WHERE id = %s", (name or None, user_id))
            return _resp(200, {'ok': True})

        return _resp(400, {'error': f'Unknown action: {action}'})
    finally:
        cur.close()
        conn.close()


def _is_online(last_seen) -> bool:
    if not last_seen:
        return False
    delta = (datetime.utcnow() - last_seen).total_seconds()
    return delta < 300


def _fmt_time(dt) -> str:
    if not dt:
        return ''
    now = datetime.utcnow()
    diff = now - dt
    if diff.days == 0:
        return dt.strftime('%H:%M')
    if diff.days == 1:
        return 'Вчера'
    return dt.strftime('%d.%m')


def _resp(status: int, payload: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=str),
    }
