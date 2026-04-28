const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const { loadData, saveData } = require('./storage.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track state per guild
// { guildId: { alertSent: bool, fullHouseStart: Date|null } }
const guildState = {};

function getState(guildId) {
  if (!guildState[guildId]) {
    guildState[guildId] = { alertSent: false, fullHouseStart: null };
  }
  return guildState[guildId];
}

// Count non-bot members currently in ANY voice channel in the guild
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

// Count total non-bot members in the guild
function getTotalMemberCount(guild) {
  return guild.members.cache.filter(m => !m.user.bot).size;
}

async function getAlertChannel(guild) {
  const data = loadData();
  const guildConfig = data.guilds?.[guild.id];
  if (!guildConfig?.alertChannelId) return null;
  return guild.channels.cache.get(guildConfig.alertChannelId) || null;
}

async function handleVoiceUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  // Ensure member cache is populated
  await guild.members.fetch();

  const voiceCount = getVoiceMemberCount(guild);
  const totalCount = getTotalMemberCount(guild);
  const state = getState(guild.id);
  const alertChannel = await getAlertChannel(guild);

  if (!alertChannel) return;

  const data = loadData();
  const guildConfig = data.guilds?.[guild.id];

  // Need at least 2 members for this to be meaningful
  if (totalCount < 2) return;

  const oneShyOfFull = voiceCount === totalCount - 1;
  const fullHouse = voiceCount === totalCount;

  // --- Transition: Almost full (one shy) ---
  if (oneShyOfFull && !state.alertSent) {
    state.alertSent = true;
    state.fullHouseStart = null;

    const missingMembers = guild.members.cache.filter(m => {
      if (m.user.bot) return false;
      // Check if they're NOT in any voice channel
      return !guild.channels.cache.some(ch => ch.isVoiceBased() && ch.members.has(m.id));
    });
    const missingList = missingMembers.map(m => `<@${m.id}>`).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('🔔 Almost a Full House!')
      .setDescription(
        `**${voiceCount}/${totalCount}** members are in voice — just one more needed!\n\n` +
        `Missing: ${missingList || 'Unknown'}\n\n` +
        `Come join the party! 🎉`
      )
      .setTimestamp()
      .setFooter({ text: 'Full House Bot' });

    await alertChannel.send({ embeds: [embed] });
  }

  // --- Transition: Full house! ---
  if (fullHouse && !state.fullHouseStart) {
    state.alertSent = false;
    state.fullHouseStart = new Date();

    const embed = new EmbedBuilder()
      .setColor(0x00FF88)
      .setTitle('🎊 FULL HOUSE! 🎊')
      .setDescription(
        `**Everyone is here!** All **${totalCount}** members have joined voice!\n\n` +
        `Let the good times roll! 🥳🎉🎈\n\n` +
        `*Recording your full-house session...*`
      )
      .setTimestamp()
      .setFooter({ text: 'Full House Bot' });

    await alertChannel.send({ embeds: [embed] });
  }

  // --- Transition: Was full, now someone left ---
  if (!fullHouse && state.fullHouseStart) {
    const duration = Date.now() - state.fullHouseStart.getTime();
    const durationStr = formatDuration(duration);
    state.fullHouseStart = null;

    // Save to history
    const record = {
      timestamp: new Date().toISOString(),
      durationMs: duration,
      durationFormatted: durationStr,
      memberCount: totalCount,
    };
    if (!data.guilds[guild.id]) data.guilds[guild.id] = {};
    if (!data.guilds[guild.id].history) data.guilds[guild.id].history = [];
    data.guilds[guild.id].history.push(record);
    saveData(data);

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('😢 Full House Ended')
      .setDescription(
        `Someone left the full house session.\n\n` +
        `**Session duration:** ${durationStr}\n` +
        `*This session has been recorded.*`
      )
      .setTimestamp()
      .setFooter({ text: 'Full House Bot' });

    await alertChannel.send({ embeds: [embed] });
  }

  // Reset alertSent if voice count drops below threshold
  if (voiceCount < totalCount - 1) {
    state.alertSent = false;
  }
}

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

// ---- Commands ----
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const prefix = config.prefix || '!fh';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  const data = loadData();
  if (!data.guilds) data.guilds = {};
  if (!data.guilds[message.guild.id]) data.guilds[message.guild.id] = {};

  // !fh setchannel #channel
  if (command === 'setchannel') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission to do that.');
    }
    const channel = message.mentions.channels.first();
    if (!channel || !channel.isTextBased()) {
      return message.reply('❌ Please mention a valid text channel. Usage: `!fh setchannel #channel`');
    }
    data.guilds[message.guild.id].alertChannelId = channel.id;
    saveData(data);
    return message.reply(`✅ Alert channel set to ${channel}!`);
  }

  // !fh status
  if (command === 'status') {
    await message.guild.members.fetch();
    const voiceCount = getVoiceMemberCount(message.guild);
    const totalCount = getTotalMemberCount(message.guild);
    const guildConfig = data.guilds[message.guild.id];
    const alertCh = guildConfig?.alertChannelId
      ? `<#${guildConfig.alertChannelId}>`
      : '*Not set*';

    const state = getState(message.guild.id);
    let sessionInfo = '';
    if (state.fullHouseStart) {
      const running = formatDuration(Date.now() - state.fullHouseStart.getTime());
      sessionInfo = `\n**🟢 Full house active for:** ${running}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Full House Bot Status')
      .addFields(
        { name: 'Voice Members', value: `${voiceCount}/${totalCount}`, inline: true },
        { name: 'Alert Channel', value: alertCh, inline: true },
        { name: 'Sessions Recorded', value: `${(guildConfig?.history || []).length}`, inline: true },
      )
      .setDescription(sessionInfo || null)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !fh history [limit]
  if (command === 'history') {
    const guildConfig = data.guilds[message.guild.id];
    const history = guildConfig?.history || [];
    if (history.length === 0) {
      return message.reply('📭 No full house sessions recorded yet!');
    }

    const limit = Math.min(parseInt(args[0]) || 5, 10);
    const recent = history.slice(-limit).reverse();

    const lines = recent.map((r, i) => {
      const date = new Date(r.timestamp).toLocaleDateString();
      return `**${i + 1}.** ${date} — ${r.durationFormatted} (${r.memberCount} members)`;
    });

    // Calculate total time
    const totalMs = history.reduce((sum, r) => sum + r.durationMs, 0);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('📜 Full House History')
      .setDescription(lines.join('\n'))
      .addFields(
        { name: 'Total Sessions', value: `${history.length}`, inline: true },
        { name: 'Total Time Together', value: formatDuration(totalMs), inline: true },
      )
      .setFooter({ text: `Showing last ${recent.length} sessions` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !fh help
  if (command === 'help' || command === '') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏠 Full House Bot — Help')
      .setDescription('Monitors voice channels and celebrates when the whole server is together!')
      .addFields(
        { name: '`!fh setchannel #channel`', value: 'Set the alert/celebration channel *(requires Manage Server)*' },
        { name: '`!fh status`', value: 'Show current voice status and config' },
        { name: '`!fh history [n]`', value: 'Show last N full-house sessions (default: 5, max: 10)' },
        { name: '`!fh help`', value: 'Show this help message' },
      )
      .setFooter({ text: 'Full House Bot' });

    return message.reply({ embeds: [embed] });
  }
});

client.on('voiceStateUpdate', handleVoiceUpdate);

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Watching ${client.guilds.cache.size} server(s)`);
});

client.login(config.token);
