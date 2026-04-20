import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from 'discord.js';

import { commands as slashCommands } from './commands.js';
import { config } from './config.js';
import {
  getApplyEvents,
  getApplyLink,
  getApplyMessages,
  getBotApiToken,
  getProgression,
  getRecruitmentCount,
  getWebLinks,
  listActiveApplys,
  sendApplyMessage,
  type Apply,
  type ApplyMessage,
  type ApplyMessageEvent,
  type ApplyStatus,
  type ProgressionEntry,
  updateApplyStatus,
} from './web-api.js';

type SyncState = {
  cursors: Record<string, string>;
  recentMessageIds: Record<string, number>;
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const state = await loadState();
let pollTimer: Timer | null = null;
let pollRunning = false;
let pollSuspendedForAuth = false;

async function ensureCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId)
    : Routes.applicationCommands(config.discordAppId);

  try {
    await rest.put(route, { body: slashCommands });
  } catch (error) {
    console.warn('Command registration skipped:', error instanceof Error ? error.message : error);
  }
}

async function loadState(): Promise<SyncState> {
  try {
    const file = Bun.file(config.applyStateFile);
    if (!(await file.exists())) {
      return { cursors: {}, recentMessageIds: {} };
    }

    const json = (await file.json()) as Partial<SyncState>;
    return {
      cursors: json.cursors ?? {},
      recentMessageIds: json.recentMessageIds ?? {},
    };
  } catch {
    return { cursors: {}, recentMessageIds: {} };
  }
}

async function saveState() {
  await Bun.write(config.applyStateFile, JSON.stringify(state, null, 2));
}

function rememberMessageId(messageId: string) {
  state.recentMessageIds[messageId] = Date.now();
}

function pruneRecentMessageIds() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [messageId, timestamp] of Object.entries(state.recentMessageIds)) {
    if (timestamp < cutoff) delete state.recentMessageIds[messageId];
  }
}

function isKnownMessage(messageId: string) {
  return Boolean(state.recentMessageIds[messageId]);
}

function formatApply(apply: Apply) {
  const parts = [apply.title ?? apply.id, `estado: ${apply.status}`];
  if (apply.discordUserId) parts.push(`discord: ${apply.discordUserId}`);
  if (apply.discordChannelId) parts.push(`channel: ${apply.discordChannelId}`);
  return parts.join(' | ');
}

function formatMessage(message: ApplyMessage) {
  const sender = message.senderType ?? 'unknown';
  return `**${sender}**: ${message.content}`;
}

function discordEmbedForApplyMessage(
  event: ApplyMessageEvent,
  applyId: string,
  channelId: string,
) {
  const message = event.message;

  const authorLabel = message.author?.discordUsername
    ? `${message.author.discordUsername}${message.author.roleLevel ? ` · ${message.author.roleLevel}` : ''}`
    : message.senderType ?? 'unknown';

  return new EmbedBuilder()
    .setTitle(`Nuevo mensaje en apply ${applyId}`)
    .setDescription(message.content)
    .addFields(
      { name: 'Sender', value: authorLabel, inline: true },
      { name: 'Message ID', value: message.id, inline: true },
      { name: 'Channel', value: channelId, inline: true },
    )
    .setColor(0x38bdf8)
    .setFooter({ text: message.createdAt });
}

async function sendToDiscordChannel(channelId: string, embed: EmbedBuilder) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
    throw new Error(`Channel ${channelId} is not available for text delivery`);
  }

  const textChannel = channel as TextBasedChannel & {
    send: (payload: { embeds: EmbedBuilder[] }) => Promise<unknown>;
  };

  await textChannel.send({ embeds: [embed] });
}

async function replyWithProgress(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const progression = await getProgression();
  const lines = progression.length
    ? progression.map((raid: ProgressionEntry) => {
        const status = raid.status ? ` · ${raid.status}` : '';
        return `• **${raid.name}** — ${raid.progress}${status}`;
      })
    : ['No hay datos de progreso disponibles.'];

  const embed = new EmbedBuilder()
    .setTitle('Progreso de Artic Tempest')
    .setDescription(lines.join('\n'))
    .setColor(0x6d28d9)
    .setURL(getWebLinks().progress);

  await interaction.editReply({ embeds: [embed] });
}

async function replyWithStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const recruitmentCount = await getRecruitmentCount();
  const links = getWebLinks();
  const embed = new EmbedBuilder()
    .setTitle('Estado de Artic Tempest')
    .setColor(0x2563eb)
    .setDescription(
      [
        `Reclutamiento activo: **${recruitmentCount}** solicitudes abiertas`,
        `Web: ${links.home}`,
        `Reclutamiento: ${links.apply}`,
      ].join('\n'),
    );

  await interaction.editReply({ embeds: [embed] });
}

async function replyWithRecruitment(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const recruitmentCount = await getRecruitmentCount();
  await interaction.editReply(`Hay **${recruitmentCount}** solicitudes activas de reclutamiento en la web.`);
}

async function replyWithWebLinks(interaction: ChatInputCommandInteraction) {
  const links = getWebLinks();
  await interaction.reply([
    `Web: ${links.home}`,
    `Reclutamiento: ${links.apply}`,
    `Progreso: ${links.progress}`,
    `API: ${links.api}`,
  ].join('\n'));
}

async function replyWithActiveApplys(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const { applys } = await listActiveApplys(interaction.options.getInteger('limit') ?? 25, interaction.options.getString('cursor') ?? undefined);

  const description = applys.length
    ? applys.map((apply, index) => `${index + 1}. ${formatApply(apply)}`).join('\n')
    : 'No hay applys activos.';

  const embed = new EmbedBuilder()
    .setTitle('Applys activos')
    .setDescription(description)
    .setColor(0x22c55e);

  await interaction.editReply({ embeds: [embed] });
}

async function replyWithApplyMessages(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const applyId = interaction.options.getString('apply_id', true);
  const limit = interaction.options.getInteger('limit') ?? 50;
  const cursor = interaction.options.getString('cursor') ?? undefined;
  const { messages } = await getApplyMessages(applyId, limit, cursor);

  const description = messages.length
    ? messages.map((message) => formatMessage(message)).join('\n')
    : 'No hay mensajes para ese apply.';

  const embed = new EmbedBuilder()
    .setTitle(`Mensajes de ${applyId}`)
    .setDescription(description)
    .setColor(0xf59e0b);

  await interaction.editReply({ embeds: [embed] });
}

async function replyWithApplyReply(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const applyId = interaction.options.getString('apply_id', true);
  const content = interaction.options.getString('content', true);

  const sentMessage = await sendApplyMessage(applyId, {
    content,
    discordUserId: interaction.user.id,
  });

  if (sentMessage?.id) {
    rememberMessageId(sentMessage.id);
    await saveState();
  }

  await interaction.editReply(
    sentMessage
      ? `Mensaje enviado al apply **${applyId}**.`
      : `No se pudo confirmar el mensaje para **${applyId}**.`,
  );
}

async function replyWithApplyStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const applyId = interaction.options.getString('apply_id', true);
  const stateValue = interaction.options.getString('state', true) as ApplyStatus;
  await updateApplyStatus(applyId, stateValue);
  await interaction.editReply(`Estado de **${applyId}** actualizado a **${stateValue}**.`);
}

async function replyWithApplyLink(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const applyId = interaction.options.getString('apply_id', true);
  const link = await getApplyLink(applyId);

  const lines = [
    `Web user: ${link?.web?.userId ?? 'n/a'}`,
    `Web chat: ${link?.web?.chatId ?? 'n/a'}`,
    `Discord user: ${link?.discord?.userId ?? 'n/a'}`,
    `Discord guild: ${link?.discord?.guildId ?? 'n/a'}`,
    `Discord channel: ${link?.discord?.channelId ?? 'n/a'}`,
    `Discord message: ${link?.discord?.messageId ?? 'n/a'}`,
  ];

  await interaction.editReply(lines.join('\n'));
}

async function pollApplyMessages() {
  if (pollRunning || !client.isReady() || pollSuspendedForAuth) return;
  pollRunning = true;

  try {
    pruneRecentMessageIds();
    const cursorKey = 'recruitment:messages';
    const cursor = state.cursors[cursorKey] || undefined;
    const { events, cursor: nextCursor } = await getApplyEvents(undefined, 25, cursor);
    const channelByApply = new Map<string, string | null>();

    for (const event of events) {
      const applyId = event.applicationId;
      const message = event.message;
      if (!applyId || !message || isKnownMessage(message.id)) continue;
      if ((message.senderType ?? '').toLowerCase() === 'bot') continue;

      let channelId = channelByApply.get(applyId) ?? null;
      if (!channelByApply.has(applyId)) {
        channelId = event.discordChannelId ?? (await getApplyLink(applyId))?.discord?.channelId ?? null;
        channelByApply.set(applyId, channelId);
      }
      if (!channelId) continue;

      const embed = discordEmbedForApplyMessage(event, applyId, channelId);
      if (!embed) continue;

      await sendToDiscordChannel(channelId, embed);
      rememberMessageId(message.id);
    }

    const fallbackCursor = events.length ? events[events.length - 1].id : null;
    const resolvedCursor = nextCursor ?? fallbackCursor;
    if (resolvedCursor && resolvedCursor !== cursor) {
      state.cursors[cursorKey] = resolvedCursor;
    }

    await saveState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('failed with 401')) {
      pollSuspendedForAuth = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      console.error('Apply polling suspended: web API auth failed (401). Set BOT_API_TOKEN or refresh .bot-api-token.json, then restart the bot.');
    } else {
      console.error('Apply poll error:', error);
    }
  } finally {
    pollRunning = false;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await pollApplyMessages();
  pollTimer = setInterval(() => void pollApplyMessages(), config.applyPollIntervalMs);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'status':
        await replyWithStatus(interaction);
        return;
      case 'progreso':
        await replyWithProgress(interaction);
        return;
      case 'reclutamiento':
        await replyWithRecruitment(interaction);
        return;
      case 'web':
        await replyWithWebLinks(interaction);
        return;
      case 'applys':
        await replyWithActiveApplys(interaction);
        return;
      case 'apply': {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'messages') {
          await replyWithApplyMessages(interaction);
          return;
        }
        if (subcommand === 'reply') {
          await replyWithApplyReply(interaction);
          return;
        }
        if (subcommand === 'status') {
          await replyWithApplyStatus(interaction);
          return;
        }
        if (subcommand === 'link') {
          await replyWithApplyLink(interaction);
          return;
        }
        await interaction.reply({ content: 'Subcomando no implementado.', ephemeral: true });
        return;
      }
      default:
        await interaction.reply({ content: 'Comando no implementado.', ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const message = 'No se pudo completar la acción.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

process.on('SIGINT', async () => {
  if (pollTimer) clearInterval(pollTimer);
  await saveState().catch(() => null);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (pollTimer) clearInterval(pollTimer);
  await saveState().catch(() => null);
  process.exit(0);
});

await ensureCommands();
await getBotApiToken();
await client.login(config.discordBotToken);
