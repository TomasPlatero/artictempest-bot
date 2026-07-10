const { buildForwardEmbed } = require('./embed-builder');
const { shouldForwardAbsenceMessage } = require('./message-filter');

const OFFICIALS_ROLE_ID = '1264627816234745888';

function createAbsenceForwarder({ client, absenceChannelId, officersChannelId }) {

  client.on('messageCreate', async (message) => {
    if (!shouldForwardAbsenceMessage(message, absenceChannelId)) return;

    const officersChannel = await client.channels.fetch(officersChannelId).catch(() => null);
    if (!officersChannel || !officersChannel.isTextBased()) {
      console.error('Officers channel not found or not text-based.');
      return;
    }

    try {
      await officersChannel.send({
        content: `<@&${OFFICIALS_ROLE_ID}>`,
        embeds: [buildForwardEmbed(message)],
        allowedMentions: { parse: [], roles: [OFFICIALS_ROLE_ID] },
      });
      await message.delete();
    } catch (error) {
      console.error('Failed to forward/delete absence message:', error);
    }
  });

  return {};
}

module.exports = {
  createAbsenceForwarder,
};
