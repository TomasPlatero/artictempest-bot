require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createDiscordClient } = require('./lib/discord/client');
const { loadDiscordConfigWithRetry } = require('./lib/config/supabase-discord-config');
const { createAbsenceForwarder } = require('./lib/discord/absence-forwarder');
const { createRecruitmentBridge } = require('./lib/recruitment/bridge');
const { Redis } = require('@upstash/redis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const WEB_BASE_URL = process.env.WEB_BASE_URL;
const WEB_BOT_API_TOKEN = process.env.WEB_BOT_API_TOKEN;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(1);
}

async function main() {
  const {
    discord_bot_token: token,
    absence_channel_id: absenceChannelId,
    officers_channel_id: officersChannelId,
  } = await loadDiscordConfigWithRetry({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });

  const client = createDiscordClient();

  client.once('clientReady', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  createAbsenceForwarder({
    client,
    absenceChannelId,
    officersChannelId,
  });

  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN &&
      WEB_BASE_URL && WEB_BOT_API_TOKEN) {
    const redisClient = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });

    const bridge = createRecruitmentBridge({
      client,
      webBaseUrl: WEB_BASE_URL,
      webApiToken: WEB_BOT_API_TOKEN,
      redisClient,
    });
    bridge.start();
  } else {
    console.warn(
      'Recruitment bridge not started. Set UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, WEB_BASE_URL, and WEB_BOT_API_TOKEN.',
    );
  }

  await client.login(token);
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
