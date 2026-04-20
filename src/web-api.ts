import { config } from './config.js';

const APPLY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DISCORD_ID_PATTERN = /^\d{6,32}$/;
const ALLOWED_APPLY_STATUSES = new Set([
  'active',
  'pending',
  'reviewing',
  'interview',
  'simulated',
  'accepted',
  'rejected',
]);

type JsonRecord = Record<string, unknown>;

export type ProgressionEntry = {
  name: string;
  expansion?: string;
  tier?: string;
  progress: string;
  status?: string;
  imageUrl?: string;
  rank?: string;
};

export type ApplyStatus = 'active' | 'pending' | 'reviewing' | 'interview' | 'simulated' | 'accepted' | 'rejected';

export type Apply = {
  id: string;
  status: ApplyStatus;
  title?: string | null;
  webUserId?: string | null;
  webChatId?: string | null;
  discordUserId?: string | null;
  discordGuildId?: string | null;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  lastMessageAt?: string | null;
};

export type ApplyMessage = {
  id: string;
  content: string;
  createdAt: string;
  senderType?: 'user' | 'staff' | 'bot' | string;
  discordUserId?: string | null;
  authorProfileId?: string | null;
  author?: {
    userId?: string | null;
    discordUserId?: string | null;
    discordUsername?: string | null;
    discordAvatar?: string | null;
    roleLevel?: string | null;
  };
};

export type ApplyLink = {
  web?: {
    userId?: string | null;
    chatId?: string | null;
  };
  discord?: {
    userId?: string | null;
    guildId?: string | null;
    channelId?: string | null;
    messageId?: string | null;
  };
};

export type ApplyMessageEvent = {
  id: string;
  cursor?: string;
  nextCursor?: string;
  event?: string;
  applicationId: string;
  discordChannelId?: string | null;
  discordUserId?: string | null;
  message: ApplyMessage;
  createdAt?: string;
};

type RecruitmentCountResponse = { count?: number; error?: string };
type ProgressionResponse = { progression?: ProgressionEntry[]; error?: string };
type ApplyListResponse = { applys?: Apply[]; applications?: Apply[]; items?: Apply[]; cursor?: string; nextCursor?: string; error?: string };
type ApplyMessagesResponse = { messages?: ApplyMessage[]; items?: ApplyMessage[]; message?: ApplyMessage; cursor?: string; nextCursor?: string; error?: string };
type ApplyMessageEventsResponse = {
  events?: (ApplyMessageEvent | JsonRecord)[];
  items?: (ApplyMessageEvent | JsonRecord)[];
  messages?: (ApplyMessageEvent | ApplyMessage | JsonRecord)[];
  cursor?: string;
  nextCursor?: string;
  error?: string;
};
type ApplyResponse = { apply?: Apply; link?: ApplyLink; error?: string };
type SendApplyMessagePayload = {
  content: string;
  discordUserId: string;
  authorProfileId?: string;
};

type CachedApiToken = {
  tokenId: string;
  token: string;
  label: string;
};

let botApiTokenPromise: Promise<string> | null = null;

function apiUrl(path: string) {
  return `${config.webBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readCachedBotApiToken() {
  try {
    const file = Bun.file(config.botApiTokenCacheFile);
    if (!(await file.exists())) return null;
    const json = (await file.json()) as Partial<CachedApiToken>;
    if (!json.token || !json.tokenId || !json.label) return null;
    return json as CachedApiToken;
  } catch {
    return null;
  }
}

export async function getBotApiToken() {
  if (!botApiTokenPromise) {
    botApiTokenPromise = (async () => {
      if (config.botApiToken) return config.botApiToken;

      const cached = await readCachedBotApiToken();
      if (cached?.token) return cached.token;

      throw new Error(`Missing bot API token. Set BOT_API_TOKEN or create ${config.botApiTokenCacheFile} with a cached token.`);
    })();
  }

  return botApiTokenPromise;
}

function assertApplyId(applyId: string) {
  if (!APPLY_ID_PATTERN.test(applyId)) {
    throw new Error('Invalid apply id format');
  }
}

function assertDiscordUserId(discordUserId: string) {
  if (!DISCORD_ID_PATTERN.test(discordUserId)) {
    throw new Error('Invalid discordUserId format');
  }
}

function assertStatus(status: string) {
  if (!ALLOWED_APPLY_STATUSES.has(status)) {
    throw new Error(`Invalid apply status: ${status}`);
  }
}

function clampLimit(limit: number, fallback: number) {
  if (!Number.isFinite(limit)) return fallback;
  const rounded = Math.floor(limit);
  if (rounded < 1) return 1;
  if (rounded > 100) return 100;
  return rounded;
}

async function authHeaders(extra: HeadersInit = {}): Promise<HeadersInit> {
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  headers['Cache-Control'] = 'no-store';
  headers.Authorization = `Bearer ${await getBotApiToken()}`;
  return headers;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: await authHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Web API ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function requestJsonWithBody<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Web API ${path} failed with ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  return (await response.json()) as T;
}

function pickItems<T>(payload: { applys?: T[]; applications?: T[]; items?: T[]; messages?: T[]; message?: T | null }) {
  return payload.applys ?? payload.applications ?? payload.items ?? payload.messages ?? (payload.message ? [payload.message] : []);
}

function pickCursor(payload: JsonRecord) {
  const cursor = payload.nextCursor ?? payload.cursor;
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

function parseApplyMessage(raw: JsonRecord): ApplyMessage | null {
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
  const content = typeof raw.content === 'string' ? raw.content : null;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : null;
  if (!id || !content || !createdAt) return null;

  const authorRaw = raw.author && typeof raw.author === 'object' ? (raw.author as JsonRecord) : null;

  return {
    id,
    content,
    createdAt,
    senderType: typeof raw.senderType === 'string' ? raw.senderType : undefined,
    discordUserId: typeof raw.discordUserId === 'string' ? raw.discordUserId : null,
    authorProfileId: typeof raw.authorProfileId === 'string' ? raw.authorProfileId : null,
    author: authorRaw
      ? {
          userId: typeof authorRaw.userId === 'string' ? authorRaw.userId : null,
          discordUserId: typeof authorRaw.discordUserId === 'string' ? authorRaw.discordUserId : null,
          discordUsername: typeof authorRaw.discordUsername === 'string' ? authorRaw.discordUsername : null,
          discordAvatar: typeof authorRaw.discordAvatar === 'string' ? authorRaw.discordAvatar : null,
          roleLevel: typeof authorRaw.roleLevel === 'string' ? authorRaw.roleLevel : null,
        }
      : undefined,
  };
}

function parseMessageCollection(payload: ApplyMessagesResponse | ApplyMessageEventsResponse) {
  return pickItems<ApplyMessage | JsonRecord>(payload)
    .map((entry) => parseApplyMessage(entry as JsonRecord))
    .filter((entry): entry is ApplyMessage => entry !== null);
}

function parseEventCollection(payload: ApplyMessageEventsResponse) {
  const rows = (payload.events ?? payload.items ?? payload.messages ?? []) as JsonRecord[];
  const events: ApplyMessageEvent[] = [];

  for (const row of rows) {
    const nestedMessage = (row.message ?? null) as JsonRecord | null;
    const message = parseApplyMessage(nestedMessage ?? row);
    const applicationIdValue = typeof row.applicationId === 'string' ? row.applicationId : null;
    if (!message || !applicationIdValue) continue;

    const event: ApplyMessageEvent = {
      id: typeof row.id === 'string' && row.id.length > 0 ? row.id : message.id,
      applicationId: applicationIdValue,
      message,
      discordChannelId: typeof row.discordChannelId === 'string' ? row.discordChannelId : null,
      discordUserId: typeof row.discordUserId === 'string' ? row.discordUserId : null,
      event: typeof row.event === 'string' ? row.event : undefined,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    };

    if (typeof row.cursor === 'string') event.cursor = row.cursor;
    if (typeof row.nextCursor === 'string') event.nextCursor = row.nextCursor;
    events.push(event);
  }

  return events;
}

export async function getRecruitmentCount() {
  const data = await requestJson<RecruitmentCountResponse>('/api/recruitment/count');
  return data.count ?? 0;
}

export async function getProgression() {
  const data = await requestJson<ProgressionResponse>('/api/progression');
  return data.progression ?? [];
}

export async function listActiveApplys(limit = 25, cursor?: string) {
  const safeLimit = clampLimit(limit, 25);
  const suffix = new URLSearchParams({ status: 'active', limit: String(safeLimit), ...(cursor ? { cursor } : {}) }).toString();
  const data = await requestJson<ApplyListResponse>(`/api/bot/recruitment/applications?${suffix}`);
  return { applys: pickItems<Apply>(data), cursor: data.nextCursor ?? data.cursor ?? null };
}

export async function getApplyMessages(applyId: string, limit = 50, cursor?: string) {
  assertApplyId(applyId);
  const safeLimit = clampLimit(limit, 50);
  const suffix = new URLSearchParams({ limit: String(safeLimit), ...(cursor ? { cursor } : {}) }).toString();
  const data = await requestJson<ApplyMessagesResponse>(`/api/bot/recruitment/applications/${encodeURIComponent(applyId)}/messages?${suffix}`);
  return { messages: parseMessageCollection(data), cursor: pickCursor(data as JsonRecord) };
}

export async function sendApplyMessage(
  applyId: string,
  payload: SendApplyMessagePayload,
) {
  assertApplyId(applyId);
  assertDiscordUserId(payload.discordUserId);
  if (!payload.content.trim()) {
    throw new Error('Message content cannot be empty');
  }

  const data = await requestJsonWithBody<ApplyMessagesResponse>(
    `/api/bot/recruitment/applications/${encodeURIComponent(applyId)}/messages`,
    'POST',
    payload,
  );
  return parseApplyMessage((data.message ?? pickItems<ApplyMessage | JsonRecord>(data)[0] ?? null) as JsonRecord) ?? null;
}

export async function updateApplyStatus(applyId: string, status: ApplyStatus) {
  assertApplyId(applyId);
  assertStatus(status);
  const data = await requestJsonWithBody<ApplyResponse>(
    `/api/bot/recruitment/applications/${encodeURIComponent(applyId)}/status`,
    'PATCH',
    { status },
  );
  return data.apply ?? null;
}

export async function getApplyLink(applyId: string) {
  assertApplyId(applyId);
  const data = await requestJson<ApplyResponse>(`/api/bot/recruitment/applications/${encodeURIComponent(applyId)}/link`);
  return data.link ?? null;
}

export async function getApplyEvents(applicationId?: string, limit = 25, cursor?: string) {
  if (applicationId) {
    assertApplyId(applicationId);
  }

  const safeLimit = clampLimit(limit, 25);
  const suffix = new URLSearchParams({ limit: String(safeLimit), ...(cursor ? { cursor } : {}), ...(applicationId ? { applicationId } : {}) }).toString();
  const data = await requestJson<ApplyMessageEventsResponse>(`/api/bot/recruitment/events/messages?${suffix}`);
  const events = parseEventCollection(data);
  return {
    events,
    messages: events,
    cursor: pickCursor(data as JsonRecord),
  };
}

export function getWebLinks() {
  return {
    home: config.webBaseUrl,
    apply: `${config.webBaseUrl}/reclutamiento`,
    progress: `${config.webBaseUrl}/progreso`,
    api: `${config.webBaseUrl}/api`,
  };
}
