# VISH

VISH is a realtime messaging application built around a galaxy-based social experience.

## Stack

### Frontend

- HTML
- CSS
- JavaScript

### Backend

- Node.js
- Express
- Socket.IO

### Database

- PostgreSQL

### Authentication

- VISH ID
- Password
- bcrypt
- Secure HTTP session

---

# Project Structure

VISH/

├── backend/
│   ├── package.json
│   ├── .env
│   ├── db/
│   │   └── schema.sql
│   └── src/
│       └── server.js
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── .gitignore
├── .env.example
└── README.md

---

# Requirements

Install:

- Node.js
- PostgreSQL
- Git

---

# Database

Create a PostgreSQL database named:

vish

Then run:

psql -U postgres -d vish -f backend/db/schema.sql

---

# Backend Setup

Open terminal:

cd backend

Install dependencies:

npm install

Create `.env`:

DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/vish

SESSION_SECRET=your-long-random-secret

PORT=3000

Start:

npm start

For development:

npm run dev

---

# Open VISH

Open:

http://localhost:3000

---

# Current Features

- VISH ID creation
- Login
- Logout
- Password hashing
- PostgreSQL persistence
- User search
- Friend requests
- Accept friend requests
- Friends list
- Galaxy home
- Mood system
- Realtime Socket.IO connection
- Realtime messages
- Message persistence
- Typing indicator
- Conversation authorization

---

# Security

Never commit:

backend/.env

Passwords are hashed with bcrypt.

Database queries use PostgreSQL parameterized queries.

Sessions are stored in PostgreSQL.

---

# Future VISH Features

- Galaxy message launch animation
- Photo messages
- Voice messages
- Music constellations
- Memory constellations
- Time capsule messages
- Message reactions
- Online presence
- Push notifications
- Block user
- Report user
- Account deletion
- Media storage
- Production HTTPS
