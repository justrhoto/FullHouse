const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const config = require("./config.js");
const { loadData, saveData } = require("./storage.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const guildState = {};

function getState(guildId) {
  if (!guildState[guildId]) {
    guildState[guildId] = { alertSent: false, fullHouseStart: null };
  }
  return guildState[guildId];
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
  return guild.members.cache.filter((m) => !m.user.bot).size;
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

  await guild.members.fetch();

  const voiceCount = getVoiceMemberCount(guild);
  const totalCount = getTotalMemberCount(guild);
  const state = getState(guild.id);
  const alertChannel = await getAlertChannel(guild);

  if (!alertChannel || totalCount < 2) return;

  const data = loadData();
  const term = data.guilds?.[guild.id]?.term || "Full House";
  const oneShyOfFull = voiceCount === totalCount - 1;
  const fullHouse = voiceCount === totalCount;

  if (oneShyOfFull && !state.alertSent) {
    state.alertSent = true;
    state.fullHouseStart = null;

    const missingMembers = guild.members.cache.filter((m) => {
      if (m.user.bot) return false;
      return !guild.channels.cache.some(
        (ch) => ch.isVoiceBased() && ch.members.has(m.id),
      );
    });
    const missingList = missingMembers.map((m) => `<@${m.id}>`).join(", ");

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle(`🔔 Almost at ${term}!`)
      .setDescription(
        `**${voiceCount}/${totalCount}** members are in voice — just one more needed!\n\n` +
          `Missing: ${missingList || "Unknown"}\n\n` +
          `Come join the party! 🎉`,
      )
      .setTimestamp()
      .setFooter({ text: "Full House Bot" });

    await alertChannel.send({ embeds: [embed] });
  }

  if (fullHouse && !state.fullHouseStart) {
    state.alertSent = false;
    state.fullHouseStart = new Date();

    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle(`🎊 ${term.toUpperCase()}! 🎊`)
      .setDescription(
        `**Everyone is here!** All **${totalCount}** members have joined voice!\n\n` +
          `Let the good times roll! 🥳🎉🎈\n\n` +
          `*Recording your ${term} session...*`,
      )
      .setTimestamp()
      .setFooter({ text: "Full House Bot" });

    await alertChannel.send({ embeds: [embed] });
  }

  if (!fullHouse && state.fullHouseStart) {
    const duration = Date.now() - state.fullHouseStart.getTime();
    const durationStr = formatDuration(duration);
    state.fullHouseStart = null;

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
      .setColor(0xff6b6b)
      .setTitle(`😢 ${term} Ended`)
      .setDescription(
        `Someone left - the voice channel is no longer ${term}.\n\n` +
          `**Session duration:** ${durationStr}\n` +
          `*This session has been recorded.*`,
      )
      .setTimestamp()
      .setFooter({ text: "Full House Bot" });

    await alertChannel.send({ embeds: [embed] });
  }

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

// ---- Slash Commands ----

const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the channel for Full House alerts")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Text channel to send alerts to")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show current voice status and bot config"),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recent full house sessions")
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("Number of sessions to show (default 5, max 10)")
        .setMinValue(1)
        .setMaxValue(10),
    ),
  new SlashCommandBuilder()
    .setName("setterm")
    .setDescription("Set the name your group uses for everyone being in VC")
    .addStringOption((opt) =>
      opt
        .setName("term")
        .setDescription('e.g. "Full Prestige", "Full House"')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
].map((cmd) => cmd.toJSON());

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild } = interaction;

  const isConfigCommand =
    commandName === "setchannel" || commandName === "setterm";
  if (
    isConfigCommand &&
    !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    return interaction.reply({
      content: "❌ You need Manage Guild permissions to use this command.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === "setchannel") {
    const channel = interaction.options.getChannel("channel");
    const data = loadData();
    if (!data.guilds[guild.id]) data.guilds[guild.id] = {};
    data.guilds[guild.id].alertChannelId = channel.id;
    saveData(data);
    return interaction.reply({
      content: `✅ Alert channel set to ${channel}!`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === "setterm") {
    const term = interaction.options.getString("term");
    const data = loadData();
    if (!data.guilds[guild.id]) data.guilds[guild.id] = {};
    data.guilds[guild.id].term = term;
    saveData(data);
    return interaction.reply({
      content: `✅ Term set to **${term}**!`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === "status") {
    await interaction.deferReply();
    await guild.members.fetch();

    const voiceCount = getVoiceMemberCount(guild);
    const totalCount = getTotalMemberCount(guild);
    const data = loadData();
    const guildConfig = data.guilds?.[guild.id];
    const term = guildConfig?.term || "Full House";
    const alertCh = guildConfig?.alertChannelId
      ? `<#${guildConfig.alertChannelId}>`
      : "*Not set*";

    const state = getState(guild.id);
    let sessionInfo = null;
    if (state.fullHouseStart) {
      const running = formatDuration(
        Date.now() - state.fullHouseStart.getTime(),
      );
      sessionInfo = `**🟢 ${term} active for:** ${running}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📊 Full House Bot Status")
      .addFields(
        {
          name: "Voice Members",
          value: `${voiceCount}/${totalCount}`,
          inline: true,
        },
        { name: "Alert Channel", value: alertCh, inline: true },
        {
          name: "Sessions Recorded",
          value: `${(guildConfig?.history || []).length}`,
          inline: true,
        },
        { name: "Term", value: term, inline: true },
      )
      .setDescription(sessionInfo)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "history") {
    const data = loadData();
    const guildConfig = data.guilds?.[guild.id];
    const term = guildConfig?.term || "Full House";
    const history = guildConfig?.history || [];
    if (history.length === 0) {
      return interaction.reply({
        content: `📭 No ${term} sessions recorded yet!`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const limit = interaction.options.getInteger("limit") ?? 5;
    const recent = history.slice(-limit).reverse();
    const lines = recent.map((r, i) => {
      const date = new Date(r.timestamp).toLocaleDateString();
      return `**${i + 1}.** ${date} — ${r.durationFormatted} (${r.memberCount} members)`;
    });
    const totalMs = history.reduce((sum, r) => sum + r.durationMs, 0);

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📜 ${term} History`)
      .setDescription(lines.join("\n"))
      .addFields(
        { name: "Total Sessions", value: `${history.length}`, inline: true },
        {
          name: "Total Time Together",
          value: formatDuration(totalMs),
          inline: true,
        },
      )
      .setFooter({ text: `Showing last ${recent.length} sessions` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
});

client.on("voiceStateUpdate", handleVoiceUpdate);

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: commands,
  });
  console.log("✅ Slash commands registered globally");
  console.log(`📡 Watching ${client.guilds.cache.size} server(s)`);
});

client.login(config.token);
