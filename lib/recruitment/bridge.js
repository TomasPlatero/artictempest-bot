const { createEventConsumer } = require('./events');
const { RecruitmentWebClient } = require('./web-client');
  const {
    buildChatMessageEmbed,
    buildStatusChangeEmbed,
    buildApplicationCreatedEmbed,
    buildApplicantReplyEmbed,
    buildReplyButtonRow,
  } = require('./dm-messages');

function createRecruitmentBridge({ client, webBaseUrl, webApiToken, supabaseClient }) {
  const webClient = new RecruitmentWebClient(webBaseUrl, webApiToken);

  async function sendDM(discordUserId, embed, components = [], attachments = []) {
    try {
      const user = await client.users.fetch(discordUserId);
      const files = Array.isArray(attachments)
        ? attachments.map((a) => ({ attachment: a.url, name: a.name }))
        : [];

      await user.send({
        embeds: [embed],
        components,
        files,
      });
      console.log(
        `[Recruitment:Bridge] DM sent to ${discordUserId}`,
      );
    } catch (error) {
      if (error.code === 50007) {
        console.warn(
          `[Recruitment:Bridge] DM skipped for ${discordUserId}: no mutual guild with the bot (Discord error 50007).`,
        );
      } else {
        console.error(
          `[Recruitment:Bridge] DM delivery failed for ${discordUserId}:`,
          error.message,
        );
      }
    }
  }

  const eventHandlers = {
    'recruitment.chat.message': async (event) => {
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      await sendDM(
        event.applicantDiscordUserId,
        buildChatMessageEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
    },

    'recruitment.application.status_changed': async (event) => {
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      await sendDM(
        event.applicantDiscordUserId,
        buildStatusChangeEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
    },

    'recruitment.application.created': async (event) => {
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      await sendDM(
        event.applicantDiscordUserId,
        buildApplicationCreatedEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
    },

    'recruitment.chat.applicant_reply': async (event) => {
      const officerUrl = `${webBaseUrl}/zona-raider/configuracion/reclutamiento/${event.applicationId}/chat`;
      await sendDM(
        event.officerDiscordUserId,
        buildApplicantReplyEmbed(event),
        [buildReplyButtonRow(officerUrl)],
        event.attachments || [],
      );
    },
  };

  const consumer = createEventConsumer(supabaseClient, eventHandlers);

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;

    const content = message.content?.trim();
    const attachments = [...message.attachments.values()].map((a) => ({ url: a.url, name: a.name, contentType: a.contentType }));

    // Allow messages with text, attachments, or both
    if (!content && attachments.length === 0) return;

    console.log(
      `[Recruitment:Bridge] DM received from ${message.author.id}: ${(content || '<attachment>').slice(0, 50)}`,
    );

    try {
      await webClient.relayDiscordMessage(message.author.id, content || '', attachments);
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
