# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Discord bot (discord.js v14) that watches voice channel membership per guild. When voice count reaches one shy of all non-bot members it pings the missing people; when everyone is present ("Full House") it celebrates and starts a session timer; when someone leaves it records the session duration. The "Full House" label is configurable per guild via `/setterm`.

## Commands

```bash
npm install        # install deps
npm start          # run the bot (node src/bot.js)
npm run dev        # run with nodemon auto-restart

npm test           # unit tests (node:test, no extra runner)
npm run lint       # eslint
npm run format     # prettier --write
npm run check      # lint + format:check + test (the CI gate)
```

There is **no compile/bundle step** — it's plain CommonJS run directly by Node; `npm run check` is the closest thing to a "build" and is what `.github/workflows/ci.yml` runs. The bot requires `DISCORD_TOKEN`, which `src/config.js` loads from the environment or a `.env` file via `dotenv`.

Requires the **Server Members** privileged gateway intent enabled in the Discord developer portal (the bot uses `GuildMembers` intent to count total members).

## Architecture

Source files in `src/`:

- **`bot.js`** — Discord wiring: client setup, slash command definitions/handlers, event listeners, login, and graceful shutdown. Delegates all pure logic to `logic.js`.
- **`logic.js`** — pure, side-effect-free helpers operating on plain objects/Maps: `formatDuration`, `getVoiceMemberCount`, `getTotalMemberCount`, `getMissingMembers`, and `evaluateVoiceState` (the transition decision). This is the unit-tested core (`test/logic.test.js`); keep it free of Discord/IO so it stays testable.
- **`config.js`** — loads `.env` via `dotenv`, exports `{ token }` from `process.env.DISCORD_TOKEN`.
- **`storage.js`** — synchronous JSON persistence (`loadData`/`saveData`) to `data.json`, located at `DATA_DIR` env var or `src/` by default. Writes go through a temp-file-then-rename for atomicity. In Docker `DATA_DIR=/data` (a mounted volume).

### Two kinds of state — keep them distinct

1. **Persistent, per-guild** in `data.json` under `guilds[guildId]`: `alertChannelId`, `term`, and `history[]` (session records). Loaded/saved on every access via `storage.js` — there is no in-memory cache, so `loadData()` is called repeatedly; mutate the returned object then `saveData()`.
2. **Ephemeral, in-memory** in the `guildState` object (`getState`): `{ alertSent, fullHouseStart }`. This is the transition-detection state machine and is **lost on restart** — an in-progress Full House session that started before a restart will not be recorded.

### Voice transition logic (`handleVoiceUpdate`)

Triggered on every `voiceStateUpdate`. `bot.js` gathers the counts (`getVoiceMemberCount` / `getTotalMemberCount`) and current state flags, then calls `evaluateVoiceState(...)` in `logic.js`, which returns `{ alert, celebrate, end, resetAlert }`. `bot.js` applies the side effects:

- `alert` (one shy, not yet alerted) → send "almost full" alert, set `alertSent`.
- `celebrate` (full, no active session) → send celebration, set `fullHouseStart`, clear `alertSent`.
- `end` (no longer full, session active) → compute duration, push a record to `history`, save, send end embed.
- `resetAlert` (two or more short) → reset `alertSent` so the alert can fire again.

When changing this behavior, update `evaluateVoiceState` and its tests rather than burying conditionals back in `bot.js`.

Early-returns if there is no configured alert channel or `totalCount < 2`. Member counts rely on `guild.members.cache`, which is why members are fetched on `clientReady` and again before `/status`.

### Slash commands

Defined as `SlashCommandBuilder[]` and registered **globally** on `clientReady` via REST `applicationCommands` (global registration can take up to an hour to propagate). Commands: `/setchannel`, `/setterm` (both gated by `ManageGuild` — enforced both via `setDefaultMemberPermissions` and a runtime `interaction.member.permissions.has` check), `/status`, `/history`.

## Deployment

Dockerfile uses `node:22-alpine`, installs with `npm ci --omit=dev`, sets `DATA_DIR=/data`, and declares a `/data` volume for `data.json` persistence. README also documents Railway, Fly.io, and pm2 options.
