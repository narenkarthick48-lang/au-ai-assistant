CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================
-- USERS
-- =========================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vish_id VARCHAR(20) NOT NULL UNIQUE,

    display_name VARCHAR(40) NOT NULL,

    password_hash TEXT NOT NULL,

    mood VARCHAR(20) NOT NULL DEFAULT 'calm',

    avatar_url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_vish_id_format
        CHECK (vish_id ~ '^[a-z0-9_]{3,20}$'),

    CONSTRAINT users_display_name_length
        CHECK (char_length(display_name) BETWEEN 1 AND 40),

    CONSTRAINT users_mood_valid
        CHECK (
            mood IN (
                'happy',
                'calm',
                'low',
                'angry',
                'love',
                'excited'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_users_vish_id
ON users(vish_id);


-- =========================================
-- FRIEND REQUESTS
-- =========================================

CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    receiver_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT friend_request_status_valid
        CHECK (
            status IN (
                'pending',
                'accepted',
                'rejected'
            )
        ),

    CONSTRAINT friend_request_not_self
        CHECK (sender_id <> receiver_id),

    UNIQUE(sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver
ON friend_requests(receiver_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
ON friend_requests(sender_id);


-- =========================================
-- CONVERSATIONS
-- =========================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================
-- CONVERSATION MEMBERS
-- =========================================

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
ON conversation_members(user_id);


-- =========================================
-- MESSAGES
-- =========================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    sender_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    content TEXT NOT NULL,

    message_type VARCHAR(20) NOT NULL DEFAULT 'text',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT message_content_length
        CHECK (
            char_length(trim(content)) BETWEEN 1 AND 4000
        ),

    CONSTRAINT message_type_valid
        CHECK (
            message_type IN (
                'text',
                'photo',
                'voice',
                'music',
                'location'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_sender
ON messages(sender_id);


-- =========================================
-- MESSAGE READ STATUS
-- =========================================

CREATE TABLE IF NOT EXISTS message_reads (
    message_id UUID NOT NULL
        REFERENCES messages(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY(message_id, user_id)
);


-- =========================================
-- TRIGGER: updated_at
-- =========================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS users_updated_at
ON users;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();


DROP TRIGGER IF EXISTS friend_requests_updated_at
ON friend_requests;

CREATE TRIGGER friend_requests_updated_at
BEFORE UPDATE ON friend_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();


DROP TRIGGER IF EXISTS conversations_updated_at
ON conversations;

CREATE TRIGGER conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
