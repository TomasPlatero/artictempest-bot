require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { Client, EmbedBuilder, GatewayIntentBits, Partials } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const PUBLIC_ABSENCE_CHANNEL_ID = process.env.PUBLIC_ABSENCE_CHANNEL_ID;
const OFFICERS_CHANNEL_ID = process.env.OFFICERS_CHANNEL_ID;

if (!TOKEN || !PUBLIC_ABSENCE_CHANNEL_ID || !OFFICERS_CHANNEL_ID) {
  console.error('Missing env vars. Set DISCORD_TOKEN, PUBLIC_ABSENCE_CHANNEL_ID, OFFICERS_CHANNEL_ID.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function buildForwardEmbed(message) {
  const attachments = [...message.attachments.values()];
  const attachmentLines = attachments.map((a) => `- ${a.name || 'archivo'}: ${a.url}`);
  const description = message.content?.trim() || '*[Sin texto]*';

  const formatDate = (date) => {
    const formatted = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);

    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const embed = new EmbedBuilder()
    .setTitle('Nueva ausencia')
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setColor(0x2f80ed)
    .setDescription(description.slice(0, 4096))
    .addFields(
      { name: 'Autor', value: `<@${message.author.id}>`, inline: true },
      { name: 'Fecha', value: formatDate(new Date()), inline: false },
    );

  if (attachmentLines.length > 0) {
    embed.addFields({ name: 'Adjuntos', value: attachmentLines.join('\n').slice(0, 1024) });
  }

  return embed;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== PUBLIC_ABSENCE_CHANNEL_ID) return;

  const officersChannel = await client.channels.fetch(OFFICERS_CHANNEL_ID).catch(() => null);
  if (!officersChannel || !officersChannel.isTextBased()) {
    console.error('Officers channel not found or not text-based.');
    return;
  }

  try {
    await officersChannel.send({
      embeds: [buildForwardEmbed(message)],
      allowedMentions: { parse: [] },
    });
    await message.delete();
  } catch (error) {
    console.error('Failed to forward/delete absence message:', error);
  }
});

client.login(TOKEN);
