const { createEventConsumer } = require('./events');
const { RecruitmentWebClient } = require('./web-client');
const {
  buildChatMessageEmbed,
  buildStatusChangeEmbed,
  buildApplicationCreatedEmbed,
  REPLY_BUTTON_ROW,
} = require('./dm-messages');

function createRecruitmentBridge({ client, webBaseUrl, webApiToken, redisClient }) {
  const webClient = new RecruitmentWebClient(webBaseUrl, webApiToken);

  async function sendDM(discordUserId, embed) {
    try {
      const user = await client.users.fetch(discordUserId);
      await user.send({
        embeds: [embed],
        components: [REPLY_BUTTON_ROW],
      });
      console.log(
        `[Recruitment:Bridge] DM sent to ${discordUserId}`,
      );
    } catch (error) {
      console.error(
        `[Recruitment:Bridge] DM delivery failed for ${discordUserId}:`,
        error.message,
      );
    }
  }

  const eventHandlers = {
    'recruitment.chat.message': async (event) => {
      await sendDM(
        event.applicantDiscordUserId,
        buildChatMessageEmbed(event),
      );
    },

    'recruitment.application.status_changed': async (event) => {
      await sendDM(
        event.applicantDiscordUserId,
        buildStatusChangeEmbed(event),
      );
    },

    'recruitment.application.created': async (event) => {
      await sendDM(
        event.applicantDiscordUserId,
        buildApplicationCreatedEmbed(event),
      );
    },
  };

  const consumer = createEventConsumer(redisClient, eventHandlers);

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;

    const content = message.content?.trim();
    if (!content) return;

    console.log(
      `[Recruitment:Bridge] DM received from ${message.author.id}: ${content.slice(0, 50)}`,
    );

    try {
      await webClient.relayDiscordMessage(message.author.id, content);
    } catch (error) {
      console.error(
        `[Recruitment:Bridge] Failed to relay DM from ${message.author.id}:`,
        error.message,
      );

      try {
        await message.author.send(
          'Hubo un problema al enviar tu mensaje. Por favor, intenta de nuevo más tarde.',
        );
      } catch (replyError) {
        console.error(
          `[Recruitment:Bridge] Failed to send error reply:`,
          replyError.message,
        );
      }
    }
  });

  function start() {
    consumer.start();
    console.log('[Recruitment:Bridge] Bridge started');
  }

  function stop() {
    consumer.stop();
  }

  return { start, stop };
}

module.exports = {
  createRecruitmentBridge,
};
