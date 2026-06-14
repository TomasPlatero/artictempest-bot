const { buildForwardEmbed } = require('./embed-builder');
const { createDiscordClient } = require('./client');
const { shouldForwardAbsenceMessage } = require('./message-filter');

function createAbsenceForwarder({ token, absenceChannelId, officersChannelId }) {
  const client = createDiscordClient();

  client.once('clientReady', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (!shouldForwardAbsenceMessage(message, absenceChannelId)) return;

    const officersChannel = await client.channels.fetch(officersChannelId).catch(() => null);
    if (!officersChannel || !officersChannel.isTextBased()) {
      console.error('Officers channel not found or not text-based.');
      return;
    }

    try {
      await officersChannel.send({
        embeds: [buildForwardEmbed(message)],
        allowedMentions: { parse: [] },
      });
      await message.delete();
    } catch (error) {
      console.error('Failed to forward/delete absence message:', error);
    }
  });

  return {
    client,
    start: () => client.login(token),
  };
}

async function startAbsenceForwarder(config) {
  const forwarder = createAbsenceForwarder(config);
  await forwarder.start();
  return forwarder.client;
}

module.exports = {
  createAbsenceForwarder,
  startAbsenceForwarder,
};
