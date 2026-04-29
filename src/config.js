module.exports = {
  token: process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  // Comma-separated Discord user IDs allowed to use bot commands.
  // Leave empty to allow everyone (subject to Discord permission checks).
  adminUserIds: process.env.ADMIN_USER_IDS
    ? process.env.ADMIN_USER_IDS.split(',').map(id => id.trim()).filter(Boolean)
    : [],
};
