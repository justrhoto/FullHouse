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

1. **Persistent config/history, per-guild** in `data.json` under `guilds[guildId]`: `alertChannelId`, `term`, and `history[]` (session records). Loaded/saved on every access via `storage.js` — there is no in-memory cache, so `loadData()` is called repeatedly; mutate the returned object then `saveData()`.
2. **Session state**, the transition-detection machine: `{ alertSent, fullHouseStart, lastAlertAt }`. Held in-memory in `guildState` as the working copy, but **also persisted** to `data.json` under `guilds[guildId].session`. `getState` hydrates it from disk on first access (`hydrateSession`), and `persistSession` writes it back via `serializeSession` — but **only on real transitions**, so steady state and idle sweeps perform no writes. `fullHouseStart` is stored as an ISO string so an in-progress Full House survives a restart and its duration is still measured from the original start. `lastAlertAt` backs the almost-full alert cooldown (`ALERT_COOLDOWN_MS`, 10 min) and persists so a restart won't immediately re-ping. Caveat: a session spanning a long outage where everyone left mid-outage will over-count duration up to the moment the bot next observes the channel isn't full — we can't know the true end time.

### Voice evaluation (`evaluateGuild`)

`evaluateGuild(guild)` gathers the counts (`getVoiceMemberCount` / `getTotalMemberCount`) and current state flags, then calls `evaluateVoiceState(...)` in `logic.js`, which returns `{ alert, celebrate, end, resetAlert, oneShyOfFull, cooldownPassed }`. `bot.js` applies the side effects:

- `alert` (one shy, not yet alerted, cooldown elapsed, not in the same beat a session ends) → send "almost full" alert, set `alertSent`/`lastAlertAt`.
- `celebrate` (full, no active session) → send celebration, set `fullHouseStart`, clear `alertSent`.
- `end` (no longer full, session active) → compute duration, push a record to `history`, save, send end embed.
- `resetAlert` (two or more short) → reset `alertSent` so the alert can fire again.

`oneShyOfFull` and `cooldownPassed` are diagnostics, not transitions: they are unused for decisions but let `bot.js` log *why* a near-full state didn't alert (armed `alertSent`, cooldown remaining, or session ending this beat). That "one shy, no alert" log line is the primary tool for diagnosing a silent miss.

**Side effects are send-first, commit-after.** Each transition builds and `await`s `alertChannel.send(...)` *before* mutating/persisting its session state, all inside a `try/catch`. A failed send (missing perms, deleted channel, rate-limit, network blip) therefore leaves state untouched, so the next sweep retries instead of the alert being silently marked sent and then suppressed by `alertSent` + cooldown. (For `end`, the `history` record is also pushed only after a successful send, so the session record isn't dropped on a failed send — at the cost of a slightly longer measured duration on retry.) The `voiceStateUpdate` handler attaches a `.catch` so eval/send rejections are logged, not swallowed.

When changing this behavior, update `evaluateVoiceState` and its tests rather than burying conditionals back in `bot.js`.

Early-returns if there is no configured alert channel or `totalCount < 2`. Member counts rely on `guild.members.cache`, which is why members are fetched on `clientReady`, on reconnect, and before `/status`.

### Why it's both event- and poll-driven

`evaluateGuild` is invoked three ways: (1) on every `voiceStateUpdate` event, (2) by a periodic reconciliation sweep (`sweepAllGuilds`, every `RECONCILE_INTERVAL_MS` = 60 s) over all cached guilds, and (3) by `resync()` on `shardResume`/`shardReady`. The sweep exists because the bot is otherwise edge-triggered: a gateway reconnect re-syncs the member/voice cache but does **not** replay `voiceStateUpdate` events, so a near-full state reached during the gap would never be announced. The sweep re-reads the (now-correct) cache and catches it; the alert cooldown + `alertSent` flag keep it from re-posting anything already announced. Gateway lifecycle events (`shardDisconnect`/`shardReconnecting`/`shardResume`) are logged for visibility.

### Slash commands

Defined as `SlashCommandBuilder[]` and registered **globally** on `clientReady` via REST `applicationCommands` (global registration can take up to an hour to propagate). Commands: `/setchannel`, `/setterm` (both gated by `ManageGuild` — enforced both via `setDefaultMemberPermissions` and a runtime `interaction.member.permissions.has` check), `/status`, `/history`.

## Deployment

Dockerfile uses `node:22-alpine`, installs with `npm ci --omit=dev`, sets `DATA_DIR=/data`, and declares a `/data` volume for `data.json` persistence. README also documents Railway, Fly.io, and pm2 options.
