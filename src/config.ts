type EnvConfig = {
  discordBotToken: string;
  discordAppId: string;
  discordGuildId: string | null;
  webBaseUrl: string;
  botApiToken: string | null;
  botApiTokenCacheFile: string;
  applyPollIntervalMs: number;
  applyStateFile: string;
};

function required(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in environment`);
  return value;
}

function optional(name: string): string | null {
  const value = Bun.env[name]?.trim();
  return value ? value : null;
}

export const config: EnvConfig = {
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordAppId: required('DISCORD_APP_ID'),
  discordGuildId: optional('DISCORD_GUILD_ID'),
  webBaseUrl: (Bun.env.ARTIC_TEMPEST_WEB_URL?.trim() || 'https://artictempest.es').replace(/\/$/, ''),
  botApiToken: optional('BOT_API_TOKEN'),
  botApiTokenCacheFile: Bun.env.BOT_API_TOKEN_CACHE_FILE?.trim() || 'generated/bot-api-token.json',
  applyPollIntervalMs: Number(Bun.env.APPLY_POLL_INTERVAL_MS?.trim() || '15000'),
  applyStateFile: Bun.env.APPLY_STATE_FILE?.trim() || 'generated/apply-state.json',
};
