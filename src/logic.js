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

// Given the current counts and ephemeral state flags, decide which transitions
// should fire. Pure: returns booleans, mutates nothing.
function evaluateVoiceState({
  voiceCount,
  totalCount,
  alertSent,
  fullHouseActive,
}) {
  if (totalCount < 2) {
    return { alert: false, celebrate: false, end: false, resetAlert: false };
  }
  const oneShyOfFull = voiceCount === totalCount - 1;
  const fullHouse = voiceCount === totalCount;
  return {
    alert: oneShyOfFull && !alertSent,
    celebrate: fullHouse && !fullHouseActive,
    end: !fullHouse && fullHouseActive,
    resetAlert: voiceCount < totalCount - 1,
  };
}

module.exports = {
  formatDuration,
  getVoiceMemberCount,
  getTotalMemberCount,
  getMissingMembers,
  evaluateVoiceState,
};
