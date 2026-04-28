# 🏠 Full House Bot

A Discord bot that monitors voice channel membership, alerts when the server is one member shy of full, celebrates when everyone's in, and records how long you spend together.

---

## Features

- 🔔 **Almost-Full Alert** — Posts a message (and pings the missing member) when voice count = total members − 1
- 🎊 **Full House Celebration** — Fires a celebration message the moment everyone is in voice
- ⏱️ **Session Tracking** — Records start time and duration of every full-house session
- 📜 **History Command** — View past sessions and cumulative time spent together
- ⚙️ **Per-Server Config** — Each server picks its own alert channel

---

## Setup

### 1. Create a Discord Application & Bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Go to the **Bot** tab → **Add Bot**.
3. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
4. Copy your **Bot Token**.

### 2. Invite the Bot to Your Server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024704&scope=bot
```

Required permissions: **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**

### 3. Install & Configure

```bash
# Clone or download this folder, then:
npm install

# Set your token in config.js, or use an environment variable:
export DISCORD_TOKEN=your_token_here
```

Edit `config.js` to set your token and optionally change the command prefix (default: `!fh`).

### 4. Run the Bot

```bash
npm start
# or for auto-restart on file changes:
npm run dev
```

---

## Commands

All commands start with `!fh` (configurable in `config.js`).

| Command | Description | Permission |
|---|---|---|
| `!fh setchannel #channel` | Set the alert & celebration channel | Manage Server |
| `!fh status` | Show current voice count and bot config | Everyone |
| `!fh history [n]` | Show last N full-house sessions (default 5) | Everyone |
| `!fh help` | Show the help embed | Everyone |

---

## How It Works

1. **Bot watches all `voiceStateUpdate` events** (joins, leaves, moves).
2. It counts **non-bot members** currently in any voice channel vs. total non-bot server members.
3. **One shy:** `voiceCount === totalMembers - 1` → fires the alert embed (once per drop-in cycle).
4. **Full house:** `voiceCount === totalMembers` → fires the celebration embed and starts a timer.
5. **Someone leaves:** stops the timer, calculates duration, saves to `data.json`, posts a session-end embed.

Session data is stored locally in `data.json` (auto-created, excluded from git).

---

## Data Storage

Sessions are saved in `data.json`:

```json
{
  "guilds": {
    "123456789": {
      "alertChannelId": "987654321",
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

## Deploying 24/7

For always-on hosting, consider:

- **[Railway](https://railway.app)** — Free tier, easy deploy from GitHub
- **[Fly.io](https://fly.io)** — Free tier, Docker-based
- **VPS** (DigitalOcean, Linode, etc.) with `pm2`:
  ```bash
  npm install -g pm2
  pm2 start bot.js --name fullhouse-bot
  pm2 save && pm2 startup
  ```

---

## Customization Ideas

- **Ping the missing member** in the alert embed (already included — `<@userId>` mention)
- **Role-based membership** — filter by a specific role instead of all members
- **Scheduled summaries** — weekly digest of full-house time using `node-cron`
- **Leaderboard** — track which member is most often the last to join
