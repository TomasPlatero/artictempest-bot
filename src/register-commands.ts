import { REST, Routes } from 'discord.js';

import { config } from './config.js';
import { commands } from './commands.js';

const rest = new REST({ version: '10' }).setToken(config.discordBotToken);

async function register() {
  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId),
      { body: commands },
    );
    console.log(`Registered guild commands for ${config.discordGuildId}`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordAppId), { body: commands });
  console.log('Registered global commands');
}

await register();
