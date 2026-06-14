require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { loadDiscordConfigWithRetry } = require('./lib/config/supabase-discord-config');
const { startAbsenceForwarder } = require('./lib/discord/absence-forwarder');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(1);
}

async function main() {
  const { discord_bot_token: token, absence_channel_id: absenceChannelId, officers_channel_id: officersChannelId } = await loadDiscordConfigWithRetry({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });

  await startAbsenceForwarder({
    token,
    absenceChannelId,
    officersChannelId,
  });
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
