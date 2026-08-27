const DEFAULT_SELECT = "discord_bot_token";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAppDiscordUrl(supabaseUrl) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/app_discord?select=${DEFAULT_SELECT}&limit=1`;
}

async function fetchDiscordConfig(supabaseUrl, supabaseAnonKey) {
  const response = await fetch(buildAppDiscordUrl(supabaseUrl), {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load Discord config from Supabase (${response.status})`,
    );
  }

  const rows = await response.json();
  const config = rows?.[0];

  if (!config?.discord_bot_token) {
    throw new Error("Missing discord_bot_token in app_discord.");
  }

  return config;
}

async function loadDiscordConfigWithRetry({
  supabaseUrl,
  supabaseAnonKey,
  retries = 5,
  logger = console,
}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fetchDiscordConfig(supabaseUrl, supabaseAnonKey);
    } catch (error) {
      lastError = error;
      logger.error(
        `Supabase config load failed (attempt ${attempt}/${retries}):`,
        error.message,
      );

      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

module.exports = {
  loadDiscordConfigWithRetry,
};
