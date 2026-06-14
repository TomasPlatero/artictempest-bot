const { EmbedBuilder } = require('discord.js');

function formatDate(date) {
  const formatted = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function buildForwardEmbed(message) {
  const attachments = [...message.attachments.values()];
  const attachmentLines = attachments.map((a) => `- ${a.name || 'archivo'}: ${a.url}`);
  const description = message.content?.trim() || '*[Sin texto]*';

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

module.exports = {
  buildForwardEmbed,
};
