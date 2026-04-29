# Full House Bot

A Discord bot that monitors voice channel membership, alerts when the server is one member shy of full, celebrates when everyone's in, and records how long you spend together.

The term "Full House" is configurable per server — call it whatever your group uses.

---

## Features

- **Almost-Full Alert** — Pings the missing member(s) when voice count = total members − 1
- **Full Celebration** — Fires a celebration embed the moment everyone joins
- **Session Tracking** — Records the start time and duration of every full session
- **History Command** — View past sessions and cumulative time spent together
- **Configurable Term** — Each server sets its own name for the event (e.g. "Full Prestige")
- **Per-Server Config** — Alert channel and term stored independently per guild
- **Docker Support** — Includes a Dockerfile with a persistent data volume

---

## Setup

### 1. Create a Discord Application & Bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Go to the **Bot** tab → **Add Bot**.
3. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
4. Copy your **Bot Token**.

### 2. Invite the Bot to Your Server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=84992&scope=bot%20applications.commands
```

Required permissions: **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**

### 3. Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token_here

# Optional: restrict config commands to specific Discord user IDs
# ADMIN_USER_IDS=123456789012345678,987654321098765432
```

### 4. Run

```bash
npm install
npm start

# or with auto-restart on file changes:
npm run dev
```

### 5. Set the Alert Channel

In Discord, run `/setchannel #your-channel` to tell the bot where to post alerts.

---

## Commands

| Command | Description | Permission |
|---|---|---|
| `/setchannel #channel` | Set the alert & celebration channel | Manage Server (+ admin ID if configured) |
| `/setterm <term>` | Set your group's name for the event | Manage Server (+ admin ID if configured) |
| `/status` | Show current voice count and bot config | Everyone |
| `/history [limit]` | Show last N sessions (default 5, max 10) | Everyone |

---

## Admin User IDs

If `ADMIN_USER_IDS` is set, only those users can run `/setchannel` and `/setterm`, regardless of their server permissions. `/status` and `/history` remain open to everyone.

To find a user ID: enable **Developer Mode** in Discord settings → right-click any user → **Copy User ID**.

---

## How It Works

1. The bot watches all `voiceStateUpdate` events (joins, leaves, moves).
2. It counts **non-bot members** in any voice channel vs. total non-bot server members.
3. **One shy:** `voiceCount === totalMembers - 1` → posts the alert embed and pings the missing member.
4. **Full:** `voiceCount === totalMembers` → posts the celebration embed and starts a timer.
5. **Someone leaves:** stops the timer, saves the session to `data.json`, posts a session-end embed.

---

## Data Storage

Sessions are saved in `data.json` (auto-created, gitignored):

```json
{
  "guilds": {
    "123456789": {
      "alertChannelId": "987654321",
      "term": "Full Prestige",
      "history": [
        {
          "timestamp": "2024-11-10T21:30:00.000Z",
          "durationMs": 5400000,
          "durationFormatted": "1h 30m 0s",
          "memberCount": 6
        }
      ]
    }
  }
}
```

---

## Docker

```bash
# Build
docker build -t fullhouse-bot .

# Run with a named volume for persistence
docker run -d \
  -e DISCORD_TOKEN=your_token_here \
  -v fullhouse-data:/data \
  fullhouse-bot
```

The `/data` volume persists `data.json` across container restarts and rebuilds.

To pass admin IDs:

```bash
docker run -d \
  -e DISCORD_TOKEN=your_token_here \
  -e ADMIN_USER_IDS=123456789012345678 \
  -v fullhouse-data:/data \
  fullhouse-bot
```

---

## Deploying 24/7

- **Docker** (above) on any VPS
- **[Railway](https://railway.app)** — easy deploy from GitHub, set env vars in the dashboard
- **[Fly.io](https://fly.io)** — Docker-native, persistent volumes available
- **VPS with pm2:**
  ```bash
  npm install -g pm2
  pm2 start src/bot.js --name fullhouse-bot
  pm2 save && pm2 startup
  ```
