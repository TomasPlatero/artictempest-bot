import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type TextBasedChannel,
} from 'discord.js';

import { config } from './config.js';
import { ensureParentDirectory } from './runtime-files.js';
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

async function clearCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId)
    : Routes.applicationCommands(config.discordAppId);

  try {
    await rest.put(route, { body: [] });
  } catch (error) {
    console.warn('Command cleanup skipped:', error instanceof Error ? error.message : error);
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
  await ensureParentDirectory(config.applyStateFile);
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
      console.error('Apply polling suspended: web API auth failed (401). Set BOT_API_TOKEN or refresh generated/bot-api-token.json, then restart the bot.');
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

await clearCommands();
await getBotApiToken();
await client.login(config.discordBotToken);
