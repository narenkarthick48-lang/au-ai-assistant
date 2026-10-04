require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
}

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing");
}


/* =========================================
   DATABASE
========================================= */

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false
});


pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL error:", error);
});


/* =========================================
   EXPRESS
========================================= */

app.disable("x-powered-by");

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

app.use(express.json({ limit: "1mb" }));

app.use(
    express.urlencoded({
        extended: false,
        limit: "1mb"
    })
);


/* =========================================
   RATE LIMITING
========================================= */

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many attempts. Please try again later."
    }
});


const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
});


app.use("/api", apiLimiter);


/* =========================================
   SESSION
========================================= */

const sessionMiddleware = session({
    store: new pgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true
    }),

    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
        httpOnly: true,

        sameSite: "lax",

        secure: process.env.NODE_ENV === "production",

        maxAge: 1000 * 60 * 60 * 24 * 30
    }
});


app.use(sessionMiddleware);


/* =========================================
   SOCKET.IO
========================================= */

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});


io.engine.use(sessionMiddleware);


/* =========================================
   HELPERS
========================================= */

function normalizeVishId(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");
}


function isValidVishId(value) {
    return /^[a-z0-9_]{3,20}$/.test(value);
}


function cleanDisplayName(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}


function cleanMessage(value) {
    return String(value || "").trim();
}


function validMood(mood) {
    return [
        "happy",
        "calm",
        "low",
        "angry",
        "love",
        "excited"
    ].includes(mood);
}


function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    next();
}


async function isConversationMember(userId, conversationId) {
    const result = await pool.query(
        `
        SELECT 1
        FROM conversation_members
        WHERE conversation_id = $1
        AND user_id = $2
        LIMIT 1
        `,
        [conversationId, userId]
    );

    return result.rowCount === 1;
}


async function areFriends(userA, userB) {
    const result = await pool.query(
        `
        SELECT 1
        FROM friend_requests
        WHERE status = 'accepted'
        AND (
            (sender_id = $1 AND receiver_id = $2)
            OR
            (sender_id = $2 AND receiver_id = $1)
        )
        LIMIT 1
        `,
        [userA, userB]
    );

    return result.rowCount === 1;
}


/* =========================================
   HEALTH
========================================= */

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            service: "VISH",
            database: "connected"
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            database: "error"
        });
    }
});


/* =========================================
   AUTH - REGISTER
========================================= */

app.post(
    "/api/auth/register",
    authLimiter,
    async (req, res) => {
        try {
            let {
                vishId,
                displayName,
                password
            } = req.body;

            vishId = normalizeVishId(vishId);
            displayName = cleanDisplayName(displayName);
            password = String(password || "");


            if (!isValidVishId(vishId)) {
                return res.status(400).json({
                    error:
                        "VISH ID must be 3-20 characters using lowercase letters, numbers or underscore."
                });
            }


            if (
                displayName.length < 1 ||
                displayName.length > 40
            ) {
                return res.status(400).json({
                    error: "Display name must be 1-40 characters."
                });
            }


            if (password.length < 8) {
                return res.status(400).json({
                    error: "Password must contain at least 8 characters."
                });
            }


            const existing = await pool.query(
                `
                SELECT id
                FROM users
                WHERE vish_id = $1
                `,
                [vishId]
            );


            if (existing.rowCount > 0) {
                return res.status(409).json({
                    error: "That VISH ID is already taken."
                });
            }


            const passwordHash = await bcrypt.hash(
                password,
                12
            );


            const result = await pool.query(
                `
                INSERT INTO users
                (
                    vish_id,
                    display_name,
                    password_hash
                )
                VALUES ($1, $2, $3)
                RETURNING
                    id,
                    vish_id,
                    display_name,
                    mood,
                    avatar_url,
                    created_at
                `,
                [
                    vishId,
                    displayName,
                    passwordHash
                ]
            );


            const user = result.rows[0];

            req.session.userId = user.id;


            res.status(201).json({
                user
            });

        } catch (error) {
            console.error("REGISTER ERROR:", error);

            res.status(500).json({
                error: "Unable to create account."
            });
        }
    }
);


/* =========================================
   AUTH - LOGIN
========================================= */

app.post(
    "/api/auth/login",
    authLimiter,
    async (req, res) => {
        try {
            const vishId = normalizeVishId(
                req.body.vishId
            );

            const password = String(
                req.body.password || ""
            );


            const result = await pool.query(
                `
                SELECT
                    id,
                    vish_id,
                    display_name,
                    password_hash,
                    mood,
                    avatar_url,
                    created_at
                FROM users
                WHERE vish_id = $1
                `,
                [vishId]
            );


            if (result.rowCount === 0) {
                return res.status(401).json({
                    error: "Invalid VISH ID or password."
                });
            }


            const user = result.rows[0];


            const passwordMatches =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );


            if (!passwordMatches) {
                return res.status(401).json({
                    error: "Invalid VISH ID or password."
                });
            }


            req.session.userId = user.id;


            delete user.password_hash;


            res.json({
                user
            });

        } catch (error) {
            console.error("LOGIN ERROR:", error);

            res.status(500).json({
                error: "Unable to login."
            });
        }
    }
);


/* =========================================
   AUTH - LOGOUT
========================================= */

app.post(
    "/api/auth/logout",
    requireAuth,
    (req, res) => {
        req.session.destroy((error) => {
            if (error) {
                console.error(error);

                return res.status(500).json({
                    error: "Unable to logout."
                });
            }

            res.clearCookie("connect.sid");

            res.json({
                success: true
            });
        });
    }
);


/* =========================================
   AUTH - CURRENT USER
========================================= */

app.get(
    "/api/me",
    requireAuth,
    async (req, res) => {
        try {
            const result = await pool.query(
                `
                SELECT
                    id,
                    vish_id,
                    display_name,
                    mood,
                    avatar_url,
                    created_at
                FROM users
                WHERE id = $1
                `,
                [req.session.userId]
            );


            if (result.rowCount === 0) {
                req.session.destroy();

                return res.status(401).json({
                    error: "User no longer exists."
                });
            }


            res.json({
                user: result.rows[0]
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error: "Unable to load account."
            });
        }
    }
);


/* =========================================
   UPDATE MOOD
========================================= */

app.patch(
    "/api/me/mood",
    requireAuth,
    async (req, res) => {
        try {
            const mood = String(
                req.body.mood || ""
            ).toLowerCase();


            if (!validMood(mood)) {
                return res.status(400).json({
                    error: "Invalid mood."
                });
            }


            const result = await pool.query(
                `
                UPDATE users
                SET mood = $1
                WHERE id = $2
                RETURNING
                    id,
                    vish_id,
                    display_name,
                    mood,
                    avatar_url
                `,
                [
                    mood,
                    req.session.userId
                ]
            );


            res.json({
                user: result.rows[0]
            });


            io.emit("user:mood", {
                userId: req.session.userId,
                mood
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error: "Unable to update mood."
            });
        }
    }
);


/* =========================================
   USER SEARCH
========================================= */

app.get(
    "/api/users/search",
    requireAuth,
    async (req, res) => {
        try {
            const query = normalizeVishId(
                req.query.q
            );


            if (
                query.length < 2 ||
                query.length > 20
            ) {
                return res.json({
                    users: []
                });
            }


            const result = await pool.query(
                `
                SELECT
                    id,
                    vish_id,
                    display_name,
                    mood,
                    avatar_url
                FROM users
                WHERE vish_id ILIKE $1
                AND id <> $2
                ORDER BY vish_id
                LIMIT 20
                `,
                [
                    `${query}%`,
                    req.session.userId
                ]
            );


            res.json({
                users: result.rows
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error: "Search failed."
            });
        }
    }
);


/* =========================================
   SEND FRIEND REQUEST
========================================= */

app.post(
    "/api/friends/request",
    requireAuth,
    async (req, res) => {
        try {
            const targetVishId =
                normalizeVishId(
                    req.body.vishId
                );


            const target = await pool.query(
                `
                SELECT id, vish_id, display_name
                FROM users
                WHERE vish_id = $1
                `,
                [targetVishId]
            );


            if (target.rowCount === 0) {
                return res.status(404).json({
                    error: "VISH ID not found."
                });
            }


            const receiverId =
                target.rows[0].id;


            if (
                receiverId ===
                req.session.userId
            ) {
                return res.status(400).json({
                    error: "You cannot add yourself."
                });
            }


            const alreadyFriends =
                await areFriends(
                    req.session.userId,
                    receiverId
                );


            if (alreadyFriends) {
                return res.status(409).json({
                    error: "You are already friends."
                });
            }


            const existing = await pool.query(
                `
                SELECT
                    id,
                    sender_id,
                    receiver_id,
                    status
                FROM friend_requests
                WHERE
                    (
                        sender_id = $1
                        AND receiver_id = $2
                    )
                    OR
                    (
                        sender_id = $2
                        AND receiver_id = $1
                    )
                ORDER BY created_at DESC
                LIMIT 1
                `,
                [
                    req.session.userId,
                    receiverId
                ]
            );


            if (existing.rowCount > 0) {
                const request =
                    existing.rows[0];


                if (request.status === "pending") {
                    return res.status(409).json({
                        error:
                            "A friend request is already pending."
                    });
                }
            }


            const result = await pool.query(
                `
                INSERT INTO friend_requests
                (
                    sender_id,
                    receiver_id
                )
                VALUES ($1, $2)
                RETURNING
                    id,
                    sender_id,
                    receiver_id,
                    status,
                    created_at
                `,
                [
                    req.session.userId,
                    receiverId
                ]
            );


            io.to(`user:${receiverId}`).emit(
                "friend:request",
                result.rows[0]
            );


            res.status(201).json({
                request: result.rows[0]
            });

        } catch (error) {
            console.error(
                "FRIEND REQUEST ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to send friend request."
            });
        }
    }
);


/* =========================================
   GET FRIEND REQUESTS
========================================= */

app.get(
    "/api/friends/requests",
    requireAuth,
    async (req, res) => {
        try {
            const result = await pool.query(
                `
                SELECT
                    fr.id,
                    fr.status,
                    fr.created_at,

                    u.id AS user_id,
                    u.vish_id,
                    u.display_name,
                    u.mood,
                    u.avatar_url

                FROM friend_requests fr

                JOIN users u
                    ON u.id = fr.sender_id

                WHERE fr.receiver_id = $1
                AND fr.status = 'pending'

                ORDER BY fr.created_at DESC
                `,
                [req.session.userId]
            );


            res.json({
                requests: result.rows
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Unable to load friend requests."
            });
        }
    }
);


/* =========================================
   ACCEPT FRIEND REQUEST
========================================= */

app.post(
    "/api/friends/requests/:requestId/accept",
    requireAuth,
    async (req, res) => {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");


            const requestResult =
                await client.query(
                    `
                    SELECT
                        id,
                        sender_id,
                        receiver_id,
                        status
                    FROM friend_requests
                    WHERE id = $1
                    AND receiver_id = $2
                    FOR UPDATE
                    `,
                    [
                        req.params.requestId,
                        req.session.userId
                    ]
                );


            if (requestResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Friend request not found."
                });
            }


            const request =
                requestResult.rows[0];


            if (request.status !== "pending") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error:
                        "This request is no longer pending."
                });
            }


            await client.query(
                `
                UPDATE friend_requests
                SET status = 'accepted'
                WHERE id = $1
                `,
                [request.id]
            );


            const conversationResult =
                await client.query(
                    `
                    INSERT INTO conversations DEFAULT VALUES
                    RETURNING id
                    `
                );


            const conversationId =
                conversationResult.rows[0].id;


            await client.query(
                `
                INSERT INTO conversation_members
                (
                    conversation_id,
                    user_id
                )
                VALUES
                    ($1, $2),
                    ($1, $3)
                `,
                [
                    conversationId,
                    request.sender_id,
                    request.receiver_id
                ]
            );


            await client.query("COMMIT");


            const response = {
                conversationId,
                friendId: request.sender_id
            };


            io.to(`user:${request.sender_id}`).emit(
                "friend:accepted",
                response
            );


            io.to(`user:${request.receiver_id}`).emit(
                "friend:accepted",
                response
            );


            res.json(response);

        } catch (error) {
            await client.query("ROLLBACK");

            console.error(
                "ACCEPT FRIEND ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to accept friend request."
            });
        } finally {
            client.release();
        }
    }
);


/* =========================================
   GET FRIENDS
========================================= */

app.get(
    "/api/friends",
    requireAuth,
    async (req, res) => {
        try {
            const result = await pool.query(
                `
                SELECT DISTINCT
                    u.id,
                    u.vish_id,
                    u.display_name,
                    u.mood,
                    u.avatar_url

                FROM friend_requests fr

                JOIN users u
                    ON u.id =
                        CASE
                            WHEN fr.sender_id = $1
                            THEN fr.receiver_id
                            ELSE fr.sender_id
                        END

                WHERE
                    (
                        fr.sender_id = $1
                        OR fr.receiver_id = $1
                    )
                    AND fr.status = 'accepted'

                ORDER BY u.vish_id
                `,
                [req.session.userId]
            );


            res.json({
                friends: result.rows
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Unable to load friends."
            });
        }
    }
);


/* =========================================
   CREATE / GET CONVERSATION
========================================= */

app.post(
    "/api/conversations",
    requireAuth,
    async (req, res) => {
        const client = await pool.connect();

        try {
            const friendId =
                String(req.body.friendId || "");


            if (!friendId) {
                return res.status(400).json({
                    error: "friendId is required."
                });
            }


            if (
                !(await areFriends(
                    req.session.userId,
                    friendId
                ))
            ) {
                return res.status(403).json({
                    error:
                        "You can only message friends."
                });
            }


            const existing =
                await client.query(
                    `
                    SELECT c.id

                    FROM conversations c

                    JOIN conversation_members cm1
                        ON cm1.conversation_id = c.id

                    JOIN conversation_members cm2
                        ON cm2.conversation_id = c.id

                    WHERE cm1.user_id = $1
                    AND cm2.user_id = $2

                    LIMIT 1
                    `,
                    [
                        req.session.userId,
                        friendId
                    ]
                );


            if (existing.rowCount > 0) {
                return res.json({
                    conversationId:
                        existing.rows[0].id
                });
            }


            await client.query("BEGIN");


            const conversation =
                await client.query(
                    `
                    INSERT INTO conversations
                    DEFAULT VALUES
                    RETURNING id
                    `
                );


            const conversationId =
                conversation.rows[0].id;


            await client.query(
                `
                INSERT INTO conversation_members
                (
                    conversation_id,
                    user_id
                )
                VALUES
                    ($1, $2),
                    ($1, $3)
                `,
                [
                    conversationId,
                    req.session.userId,
                    friendId
                ]
            );


            await client.query("COMMIT");


            res.status(201).json({
                conversationId
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to create conversation."
            });
        } finally {
            client.release();
        }
    }
);


/* =========================================
   GET CONVERSATION MESSAGES
========================================= */

app.get(
    "/api/conversations/:conversationId/messages",
    requireAuth,
    async (req, res) => {
        try {
            const conversationId =
                req.params.conversationId;


            const member =
                await isConversationMember(
                    req.session.userId,
                    conversationId
                );


            if (!member) {
                return res.status(403).json({
                    error:
                        "You are not a member of this conversation."
                });
            }


            const result = await pool.query(
                `
                SELECT
                    m.id,
                    m.conversation_id,
                    m.sender_id,
                    u.vish_id AS sender_vish_id,
                    u.display_name AS sender_name,
                    m.content,
                    m.message_type,
                    m.created_at

                FROM messages m

                JOIN users u
                    ON u.id = m.sender_id

                WHERE m.conversation_id = $1

                ORDER BY m.created_at ASC

                LIMIT 100
                `,
                [conversationId]
            );


            res.json({
                messages: result.rows
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Unable to load messages."
            });
        }
    }
);


/* =========================================
   SOCKET AUTH
========================================= */

io.use((socket, next) => {
    const sessionData =
        socket.request.session;

    if (!sessionData?.userId) {
        return next(
            new Error("Unauthorized")
        );
    }

    next();
});


/* =========================================
   SOCKET CONNECTION
========================================= */

io.on("connection", async (socket) => {
    const userId =
        socket.request.session.userId;


    socket.join(`user:${userId}`);


    console.log(
        `VISH user connected: ${userId}`
    );


    socket.emit("connected", {
        userId
    });


    /* -------------------------------------
       JOIN CONVERSATION
    ------------------------------------- */

    socket.on(
        "conversation:join",
        async (
            conversationId,
            callback
        ) => {
            try {
                const member =
                    await isConversationMember(
                        userId,
                        conversationId
                    );


                if (!member) {
                    return callback?.({
                        ok: false,
                        error:
                            "Not a conversation member."
                    });
                }


                socket.join(
                    `conversation:${conversationId}`
                );


                callback?.({
                    ok: true
                });

            } catch (error) {
                console.error(error);

                callback?.({
                    ok: false,
                    error: "Unable to join."
                });
            }
        }
    );


    /* -------------------------------------
       SEND MESSAGE
    ------------------------------------- */

    socket.on(
        "message:send",
        async (
            data,
            callback
        ) => {
            try {
                const conversationId =
                    String(
                        data?.conversationId || ""
                    );

                const content =
                    cleanMessage(
                        data?.content
                    );

                const messageType =
                    String(
                        data?.messageType ||
                        "text"
                    );


                if (!conversationId) {
                    return callback?.({
                        ok: false,
                        error:
                            "Conversation ID required."
                    });
                }


                if (
                    !content ||
                    content.length > 4000
                ) {
                    return callback?.({
                        ok: false,
                        error:
                            "Message must be 1-4000 characters."
                    });
                }


                if (
                    ![
                        "text",
                        "photo",
                        "voice",
                        "music",
                        "location"
                    ].includes(messageType)
                ) {
                    return callback?.({
                        ok: false,
                        error:
                            "Invalid message type."
                    });
                }


                const member =
                    await isConversationMember(
                        userId,
                        conversationId
                    );


                if (!member) {
                    return callback?.({
                        ok: false,
                        error:
                            "You are not a member of this conversation."
                    });
                }


                const result =
                    await pool.query(
                        `
                        INSERT INTO messages
                        (
                            conversation_id,
                            sender_id,
                            content,
                            message_type
                        )
                        VALUES
                        ($1, $2, $3, $4)
                        RETURNING
                            id,
                            conversation_id,
                            sender_id,
                            content,
                            message_type,
                            created_at
                        `,
                        [
                            conversationId,
                            userId,
                            content,
                            messageType
                        ]
                    );


                const message =
                    result.rows[0];


                const sender =
                    await pool.query(
                        `
                        SELECT
                            vish_id,
                            display_name
                        FROM users
                        WHERE id = $1
                        `,
                        [userId]
                    );


                message.sender_vish_id =
                    sender.rows[0].vish_id;

                message.sender_name =
                    sender.rows[0].display_name;


                await pool.query(
                    `
                    UPDATE conversations
                    SET updated_at = NOW()
                    WHERE id = $1
                    `,
                    [conversationId]
                );


                io.to(
                    `conversation:${conversationId}`
                ).emit(
                    "message:new",
                    message
                );


                callback?.({
                    ok: true,
                    message
                });

            } catch (error) {
                console.error(
                    "SEND MESSAGE ERROR:",
                    error
                );

                callback?.({
                    ok: false,
                    error:
                        "Unable to send message."
                });
            }
        }
    );


    /* -------------------------------------
       TYPING
    ------------------------------------- */

    socket.on(
        "typing",
        async (data) => {
            try {
                const conversationId =
                    String(
                        data?.conversationId || ""
                    );

                const typing =
                    Boolean(data?.typing);


                const member =
                    await isConversationMember(
                        userId,
                        conversationId
                    );


                if (!member) {
                    return;
                }


                socket
                    .to(
                        `conversation:${conversationId}`
                    )
                    .emit(
                        "typing",
                        {
                            userId,
                            typing
                        }
                    );

            } catch (error) {
                console.error(error);
            }
        }
    );


    /* -------------------------------------
       DISCONNECT
    ------------------------------------- */

    socket.on(
        "disconnect",
        () => {
            console.log(
                `VISH user disconnected: ${userId}`
            );
        }
    );
});


/* =========================================
   FRONTEND STATIC FILES
========================================= */

app.use(
    express.static(
        path.join(
            __dirname,
            "../../frontend"
        )
    )
);


app.get("*", (req, res) => {
    if (
        req.path.startsWith("/api/")
    ) {
        return res.status(404).json({
            error: "API route not found."
        });
    }

    res.sendFile(
        path.join(
            __dirname,
            "../../frontend/index.html"
        )
    );
});


/* =========================================
   START SERVER
========================================= */

server.listen(
    PORT,
    () => {
        console.log("");
        console.log("================================");
        console.log("        VISH SERVER");
        console.log("================================");
        console.log(
            `Running: http://localhost:${PORT}`
        );
        console.log(
            "Database: PostgreSQL"
        );
        console.log(
            "Realtime: Socket.IO"
        );
        console.log(
            "Auth: Session + bcrypt"
        );
        console.log("================================");
        console.log("");
    }
);
