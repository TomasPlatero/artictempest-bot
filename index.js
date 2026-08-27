require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });

const { createDiscordClient } = require("./lib/discord/client");
const {
  loadDiscordConfigWithRetry,
} = require("./lib/config/supabase-discord-config");
const { createRecruitmentBridge } = require("./lib/recruitment/bridge");
const { createSupabaseClient } = require("./lib/supabase/client");
const { createAutomationsLoader } = require("./lib/automations/loader");
const { createAutomationExecutor } = require("./lib/automations/executor");
const { createCommandsLoader } = require("./lib/commands/loader");
const { createCommandHandler } = require("./lib/commands/handler");
const { createAuditLogger } = require("./lib/audit/logger");
const { createTempVoiceChannels } = require("./lib/voice/temp-channels");
const { createWelcomeSystem } = require("./lib/welcome/welcome");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEB_BASE_URL = process.env.WEB_BASE_URL;
const WEB_BOT_API_TOKEN = process.env.WEB_BOT_API_TOKEN;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  process.exit(1);
}

async function main() {
  const { discord_bot_token: token } = await loadDiscordConfigWithRetry({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });

  const client = createDiscordClient();

  client.once("clientReady", (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  // Automations (MEE6-style) — require MySQL env vars
  if (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE) {
    const automationsLoader = createAutomationsLoader();
    createAutomationExecutor({
      client,
      loadAutomations: automationsLoader.loadAutomations,
    });
    console.log("[Automations] Executor started");

    const commandsLoader = createCommandsLoader();
    createCommandHandler({
      client,
      loadCommands: commandsLoader.loadCommands,
    });
    console.log("[Commands] Handler started");

    createAuditLogger({ client });
    console.log("[Audit] Logger started");

    createTempVoiceChannels({ client });
    console.log("[TempVoice] Handler started");

    createWelcomeSystem({ client });
    console.log("[Welcome] Handler started");
  } else {
    console.warn("[Automations] MySQL env vars not set — automations disabled");
  }

  if (WEB_BASE_URL && WEB_BOT_API_TOKEN) {
    const supabaseClient = createSupabaseClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
    );

    const bridge = createRecruitmentBridge({
      client,
      webBaseUrl: WEB_BASE_URL,
      webApiToken: WEB_BOT_API_TOKEN,
      supabaseClient,
    });
    bridge.start();
  } else {
    console.warn(
      "Recruitment bridge not started. Set WEB_BASE_URL and WEB_BOT_API_TOKEN.",
    );
  }

  await client.login(token);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
