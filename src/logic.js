// logic.js — Pure helpers for voice-state evaluation (no Discord side effects).
// Everything here works on plain objects/Maps so it can be unit-tested without a client.

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getVoiceMemberCount(guild) {
  let count = 0;
  for (const [, channel] of guild.channels.cache) {
    if (channel.isVoiceBased()) {
      for (const [, member] of channel.members) {
        if (!member.user.bot) count++;
      }
    }
  }
  return count;
}

function getTotalMemberCount(guild) {
  let count = 0;
  for (const [, member] of guild.members.cache) {
    if (!member.user.bot) count++;
  }
  return count;
}

function getMissingMembers(guild) {
  const missing = [];
  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    let inVoice = false;
    for (const [, channel] of guild.channels.cache) {
      if (channel.isVoiceBased() && channel.members.has(member.id)) {
        inVoice = true;
        break;
      }
    }
    if (!inVoice) missing.push(member);
  }
  return missing;
}

// Minimum time between "almost full" alerts for a guild. Stops a member who
// disconnects/reconnects near the threshold from re-pinging the missing people.
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Given the current counts and ephemeral state flags, decide which transitions
// should fire. Pure: returns booleans, mutates nothing.
function evaluateVoiceState({
  voiceCount,
  totalCount,
  alertSent,
  fullHouseActive,
  lastAlertAt = null,
  now = Date.now(),
}) {
  if (totalCount < 2) {
    return { alert: false, celebrate: false, end: false, resetAlert: false };
  }
  const oneShyOfFull = voiceCount === totalCount - 1;
  const fullHouse = voiceCount === totalCount;
  const end = !fullHouse && fullHouseActive;
  const cooldownPassed =
    lastAlertAt === null || now - lastAlertAt >= ALERT_COOLDOWN_MS;
  return {
    // Suppress the alert while it's still armed, during the cooldown window, or
    // in the same beat a full session ends (avoids the end + "come join" double-post).
    alert: oneShyOfFull && !alertSent && !end && cooldownPassed,
    celebrate: fullHouse && !fullHouseActive,
    end,
    resetAlert: voiceCount < totalCount - 1,
  };
}

// The default (no session yet / not persisted) per-guild ephemeral state.
function defaultSession() {
  return { alertSent: false, fullHouseStart: null, lastAlertAt: null };
}

// Convert the in-memory state to a JSON-safe shape for data.json. fullHouseStart
// is a Date in memory, stored as an ISO string so an in-progress session survives
// a restart and its duration is measured from the original start.
function serializeSession(state) {
  return {
    alertSent: Boolean(state.alertSent),
    fullHouseStart: state.fullHouseStart
      ? new Date(state.fullHouseStart).toISOString()
      : null,
    lastAlertAt: state.lastAlertAt ?? null,
  };
}

// Inverse of serializeSession: rebuild the in-memory state from data.json.
function hydrateSession(saved) {
  if (!saved) return defaultSession();
  return {
    alertSent: Boolean(saved.alertSent),
    fullHouseStart: saved.fullHouseStart
      ? new Date(saved.fullHouseStart)
      : null,
    lastAlertAt: saved.lastAlertAt ?? null,
  };
}

module.exports = {
  ALERT_COOLDOWN_MS,
  formatDuration,
  getVoiceMemberCount,
  getTotalMemberCount,
  getMissingMembers,
  evaluateVoiceState,
  defaultSession,
  serializeSession,
  hydrateSession,
};
