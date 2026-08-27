const { Client, GatewayIntentBits, Partials } = require("discord.js");

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

module.exports = {
  createDiscordClient,
};
