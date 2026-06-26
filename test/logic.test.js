const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALERT_COOLDOWN_MS,
  formatDuration,
  getVoiceMemberCount,
  getTotalMemberCount,
  getMissingMembers,
  evaluateVoiceState,
  defaultSession,
  serializeSession,
  hydrateSession,
} = require("../src/logic.js");

// --- Mock builders (mimic the bits of discord.js the helpers touch) ---

function member(id, { bot = false } = {}) {
  return { id, user: { bot } };
}

function voiceChannel(members = []) {
  return {
    isVoiceBased: () => true,
    members: new Map(members.map((m) => [m.id, m])),
  };
}

function textChannel() {
  return { isVoiceBased: () => false, members: new Map() };
}

function makeGuild({ members = [], channels = [] } = {}) {
  return {
    members: { cache: new Map(members.map((m) => [m.id, m])) },
    channels: { cache: new Map(channels.map((c, i) => [String(i), c])) },
  };
}

// --- formatDuration ---

test("formatDuration: seconds only", () => {
  assert.equal(formatDuration(5000), "5s");
});

test("formatDuration: minutes and seconds", () => {
  assert.equal(formatDuration(90 * 1000), "1m 30s");
});

test("formatDuration: hours, minutes, seconds", () => {
  assert.equal(formatDuration((2 * 3600 + 5 * 60 + 3) * 1000), "2h 5m 3s");
});

test("formatDuration: days and hours", () => {
  assert.equal(formatDuration(26 * 3600 * 1000), "1d 2h 0m");
});

// --- counting ---

test("getVoiceMemberCount ignores bots and text channels", () => {
  const guild = makeGuild({
    channels: [
      voiceChannel([member("a"), member("b"), member("bot", { bot: true })]),
      textChannel(),
    ],
  });
  assert.equal(getVoiceMemberCount(guild), 2);
});

test("getTotalMemberCount ignores bots", () => {
  const guild = makeGuild({
    members: [member("a"), member("b"), member("bot", { bot: true })],
  });
  assert.equal(getTotalMemberCount(guild), 2);
});

test("getMissingMembers returns non-bot members not in any voice channel", () => {
  const a = member("a");
  const guild = makeGuild({
    members: [a, member("b"), member("c"), member("bot", { bot: true })],
    channels: [voiceChannel([a])],
  });
  const missing = getMissingMembers(guild)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(missing, ["b", "c"]);
});

// --- evaluateVoiceState ---

test("evaluateVoiceState: no-op with fewer than 2 members", () => {
  assert.deepEqual(
    evaluateVoiceState({
      voiceCount: 1,
      totalCount: 1,
      alertSent: false,
      fullHouseActive: false,
    }),
    {
      alert: false,
      celebrate: false,
      end: false,
      resetAlert: false,
      oneShyOfFull: false,
      cooldownPassed: false,
    },
  );
});

test("evaluateVoiceState: exposes oneShyOfFull / cooldownPassed diagnostics", () => {
  const armed = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: true,
    fullHouseActive: false,
  });
  // One shy but suppressed because already alerted — diagnostics explain why.
  assert.equal(armed.alert, false);
  assert.equal(armed.oneShyOfFull, true);
  assert.equal(armed.cooldownPassed, true);

  const cooling = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: false,
    lastAlertAt: 1_000_000 - 1,
    now: 1_000_000,
  });
  assert.equal(cooling.oneShyOfFull, true);
  assert.equal(cooling.cooldownPassed, false);
});

test("evaluateVoiceState: alerts when one shy and not yet alerted", () => {
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: false,
  });
  assert.equal(r.alert, true);
});

test("evaluateVoiceState: does not re-alert when already alerted", () => {
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: true,
    fullHouseActive: false,
  });
  assert.equal(r.alert, false);
});

test("evaluateVoiceState: celebrates when full and not already active", () => {
  const r = evaluateVoiceState({
    voiceCount: 3,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: false,
  });
  assert.equal(r.celebrate, true);
  assert.equal(r.end, false);
});

test("evaluateVoiceState: ends when no longer full but session active", () => {
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: true,
  });
  assert.equal(r.end, true);
});

test("evaluateVoiceState: resets alert when two or more short", () => {
  const r = evaluateVoiceState({
    voiceCount: 1,
    totalCount: 3,
    alertSent: true,
    fullHouseActive: false,
  });
  assert.equal(r.resetAlert, true);
});

test("evaluateVoiceState: suppresses alert within the cooldown window", () => {
  const now = 1_000_000;
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: false,
    lastAlertAt: now - (ALERT_COOLDOWN_MS - 1),
    now,
  });
  assert.equal(r.alert, false);
});

test("evaluateVoiceState: allows alert once the cooldown has elapsed", () => {
  const now = 1_000_000;
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: false,
    lastAlertAt: now - ALERT_COOLDOWN_MS,
    now,
  });
  assert.equal(r.alert, true);
});

test("evaluateVoiceState: does not alert in the same beat a session ends", () => {
  // Full house (3/3) breaks to one-shy (2/3): end fires, almost-full must not.
  const r = evaluateVoiceState({
    voiceCount: 2,
    totalCount: 3,
    alertSent: false,
    fullHouseActive: true,
    lastAlertAt: null, // cooldown long expired, so only the end-guard suppresses it
    now: 1_000_000,
  });
  assert.equal(r.end, true);
  assert.equal(r.alert, false);
});

// --- session persistence ---

test("hydrateSession returns defaults for missing/undefined session", () => {
  assert.deepEqual(hydrateSession(undefined), defaultSession());
  assert.deepEqual(hydrateSession(null), defaultSession());
});

test("session survives a serialize -> hydrate round-trip with an active session", () => {
  const start = new Date("2026-06-24T20:00:00.000Z");
  const state = { alertSent: true, fullHouseStart: start, lastAlertAt: 1700 };

  const restored = hydrateSession(serializeSession(state));

  assert.equal(restored.alertSent, true);
  assert.equal(restored.lastAlertAt, 1700);
  assert.ok(restored.fullHouseStart instanceof Date);
  // Same instant, so an in-progress session's duration is measured from the
  // original start after a restart.
  assert.equal(restored.fullHouseStart.getTime(), start.getTime());
});

test("serializeSession stores fullHouseStart as null when no session is active", () => {
  const serialized = serializeSession(defaultSession());
  assert.equal(serialized.fullHouseStart, null);
  assert.equal(serialized.alertSent, false);
  assert.equal(serialized.lastAlertAt, null);
});
