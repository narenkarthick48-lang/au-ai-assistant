CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vish_id VARCHAR(20) NOT NULL UNIQUE,

    display_name VARCHAR(40) NOT NULL,

    password_hash TEXT NOT NULL,

    mood VARCHAR(20) NOT NULL DEFAULT 'calm',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- FRIEND REQUESTS
-- =========================================================

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

    UNIQUE(sender_id, receiver_id),

    CHECK(sender_id <> receiver_id),

    CHECK(status IN ('pending', 'accepted', 'rejected'))
);


-- =========================================================
-- CONVERSATIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- CONVERSATION MEMBERS
-- =========================================================

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (conversation_id, user_id)
);


-- =========================================================
-- MESSAGES
-- =========================================================

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

    CHECK(char_length(content) BETWEEN 1 AND 4000)
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_users_vish_id
ON users(vish_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver
ON friend_requests(receiver_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
ON friend_requests(sender_id);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
ON conversation_members(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id, created_at);
