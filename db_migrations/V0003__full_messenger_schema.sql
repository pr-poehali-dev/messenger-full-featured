-- Обновляем users: добавляем display_name и avatar
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(30) DEFAULT 'from-violet-500 to-fuchsia-500';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW();

-- Диалоги (личные чаты между двумя пользователями)
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER NOT NULL REFERENCES users(id),
    user2_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user1_id, user2_id)
);

-- Сообщения
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id),
    channel_id INTEGER,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

-- Каналы/группы
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    username VARCHAR(80) UNIQUE,
    description TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    avatar_color VARCHAR(30) DEFAULT 'from-indigo-500 to-purple-500',
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_username ON channels(username);

-- Участники каналов
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id INTEGER NOT NULL REFERENCES channels(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role VARCHAR(20) DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

-- WebRTC сигналинг
CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    caller_id INTEGER NOT NULL REFERENCES users(id),
    callee_id INTEGER REFERENCES users(id),
    channel_id INTEGER REFERENCES channels(id),
    status VARCHAR(20) DEFAULT 'ringing',
    call_type VARCHAR(10) DEFAULT 'audio',
    offer TEXT,
    answer TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ice_candidates (
    id SERIAL PRIMARY KEY,
    call_id INTEGER NOT NULL REFERENCES calls(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    candidate TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);