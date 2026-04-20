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
  getApplyDiscordPayload,
  getApplyLink,
  getApplyMessages,
  getBotApiToken,
  getProgression,
  getRecruitmentCount,
  getWebLinks,
  listApplysByStatus,
  saveApplyLink,
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
  applyEmbeds: Record<
    string,
    { messageId: string; status: ApplyStatus; updatedAt: string; channelId: string }
  >;
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const state = await loadState();
let pollTimer: Timer | null = null;
let pollRunning = false;
let pollSuspendedForAuth = false;
let embedPollRunning = false;

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
      return { cursors: {}, recentMessageIds: {}, applyEmbeds: {} };
    }

    const json = (await file.json()) as Partial<SyncState>;
    return {
      cursors: json.cursors ?? {},
      recentMessageIds: json.recentMessageIds ?? {},
      applyEmbeds: json.applyEmbeds ?? {},
    };
  } catch {
    return { cursors: {}, recentMessageIds: {}, applyEmbeds: {} };
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

function rememberApplyEmbed(
  applyId: string,
  messageId: string,
  status: ApplyStatus,
  updatedAt: string,
  channelId: string,
) {
  state.applyEmbeds[applyId] = { messageId, status, updatedAt, channelId };
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

async function sendApplyPayloadToDiscord(
  channelId: string,
  payload: Record<string, unknown>,
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
    throw new Error(`Channel ${channelId} is not available for text delivery`);
  }

  const textChannel = channel as TextBasedChannel & {
    send: (payload: Record<string, unknown>) => Promise<{ id: string }>;
  };

  return textChannel.send(payload);
}

async function editApplyPayloadInDiscord(
  channelId: string,
  messageId: string,
  payload: Record<string, unknown>,
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
    throw new Error(`Channel ${channelId} is not available for text delivery`);
  }

  const textChannel = channel as TextBasedChannel & {
    messages: { fetch: (id: string) => Promise<{ edit: (payload: Record<string, unknown>) => Promise<unknown> }> };
  };

  const message = await textChannel.messages.fetch(messageId);
  return message.edit(payload);
}

async function pollRecruitmentEmbeds() {
  if (embedPollRunning || !client.isReady() || pollSuspendedForAuth) return;
  embedPollRunning = true;

  try {
    const [activeResult, resolvedResult] = await Promise.all([
      listApplysByStatus('active', 100),
      listApplysByStatus('resolved', 100),
    ]);

    const applyMap = new Map<string, Apply>();
    for (const apply of [...activeResult.applys, ...resolvedResult.applys]) {
      applyMap.set(apply.id, apply);
    }

    for (const apply of applyMap.values()) {
      const snapshot = state.applyEmbeds[apply.id] ?? null;

      const channelId = apply.discordChannelId ?? snapshot?.channelId ?? null;
      const currentUpdatedAt = apply.updatedAt ?? apply.createdAt ?? '';
      const messageId = apply.discordMessageId ?? snapshot?.messageId ?? null;

      const shouldRefresh =
        !messageId ||
        !snapshot ||
        snapshot.status !== apply.status ||
        snapshot.updatedAt !== currentUpdatedAt ||
        snapshot.channelId !== channelId;

      if (!channelId || !shouldRefresh) {
        if (messageId && channelId) {
          rememberApplyEmbed(apply.id, messageId, apply.status, currentUpdatedAt, channelId);
        }
        continue;
      }

      const payload = await getApplyDiscordPayload(apply.id, !messageId);
      if (!payload) continue;

      if (!messageId) {
        const sent = await sendApplyPayloadToDiscord(channelId, payload);
        rememberApplyEmbed(apply.id, sent.id, apply.status, currentUpdatedAt, channelId);
        await saveApplyLink(apply.id, sent.id).catch((error) => {
          console.error('Failed to persist apply embed link:', error);
        });
        continue;
      }

      await editApplyPayloadInDiscord(channelId, messageId, payload);
      rememberApplyEmbed(apply.id, messageId, apply.status, currentUpdatedAt, channelId);
      if (apply.discordMessageId !== messageId) {
        await saveApplyLink(apply.id, messageId).catch((error) => {
          console.error('Failed to refresh apply embed link:', error);
        });
      }
    }

    await saveState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('failed with 401')) {
      pollSuspendedForAuth = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      console.error('Recruitment embed polling suspended: web API auth failed (401). Set BOT_API_TOKEN or refresh generated/bot-api-token.json, then restart the bot.');
    } else {
      console.error('Recruitment embed poll error:', error);
    }
  } finally {
    embedPollRunning = false;
  }
}

async function pollRecruitmentSync() {
  await pollRecruitmentEmbeds();
  await pollApplyMessages();
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
  await pollRecruitmentSync();
  pollTimer = setInterval(() => void pollRecruitmentSync(), config.applyPollIntervalMs);
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
