# artictempest-bot

Discord bot for Artic Tempest using Bun + TypeScript + discord.js.

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies: `bun install`
3. Run the bot: `bun run dev`
4. Register commands manually if needed: `bun run register:commands`

## Config

- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID` (optional, recommended for testing)
- `ARTIC_TEMPEST_WEB_URL` (default: `https://artictempest.es`)
- `BOT_API_TOKEN` (optional, direct token override)
- `BOT_API_TOKEN_CACHE_FILE` (default: `.bot-api-token.json`)
- `APPLY_POLL_INTERVAL_MS` (default: `15000`)
- `APPLY_STATE_FILE` (default: `apply-state.json`)

El bot usa `BOT_API_TOKEN` o `BOT_API_TOKEN_CACHE_FILE` para autenticarse con la web.

## Commands

- `/status`
- `/progreso`
- `/reclutamiento`
- `/web`
- `/applys`
- `/apply messages`
- `/apply reply`
- `/apply status`
- `/apply link`
