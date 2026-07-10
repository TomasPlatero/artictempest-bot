const { EmbedBuilder } = require('discord.js');

const STATUS_LABELS = {
  pending: 'Nuevo',
  reviewing: 'En Revisión',
  paused: 'En Pausa',
  interview: 'Entrevista',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelado: 'Cancelado',
};

const STATUS_COLORS = {
  pending: 0x3b82f6,
  reviewing: 0x8b5cf6,
  paused: 0x9ca3af,
  interview: 0xf59e0b,
  accepted: 0x10b981,
  rejected: 0xef4444,
  cancelado: 0x71717a,
};

function buildChatMessageEmbed(event) {
  const truncated =
    event.content.length > 300
      ? event.content.slice(0, 297) + '...'
      : event.content;

  const officerLine =
    event.officerName
      ? `${event.officerName}${event.officerRoleLabel ? ` - ${event.officerRoleLabel}` : ''} de`
      : 'Un oficial de';

  return new EmbedBuilder()
    .setTitle('Nuevo mensaje de Artic Tempest')
    .setDescription(
      `${officerLine} **Artic Tempest** te ha enviado un mensaje sobre tu solicitud:\n\n> ${truncated}`,
    )
    .setColor(0x3b82f6)
    .setTimestamp(new Date(event.createdAt))
    .setFooter({ text: 'Responde directamente por este DM' });
}

function buildStatusChangeEmbed(event) {
  const label = STATUS_LABELS[event.status] || event.status;
  const color = STATUS_COLORS[event.status] || 0x2b2d31;
  const characterLine =
    event.characterName && event.characterRealm
      ? `\nPersonaje: **${event.characterName}** - ${event.characterRealm}`
      : '';

  return new EmbedBuilder()
    .setTitle('Estado de solicitud actualizado')
    .setDescription(
      `${characterLine}\n\nTu solicitud ha cambiado de estado: **${label}**`,
    )
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Reclutamiento Artic Tempest' });
}

function buildApplicationCreatedEmbed(event) {
  const characterLine =
    event.characterName && event.characterRealm
      ? `\nPersonaje: **${event.characterName}** - ${event.characterRealm}`
      : '';

  return new EmbedBuilder()
    .setTitle('Solicitud recibida')
    .setDescription(
      `¡Gracias por tu interés en unirte a **Artic Tempest**!${characterLine}\n\nTu solicitud ha sido registrada. Un oficial la revisará pronto. Puedes responder por este DM si tienes preguntas.`,
    )
    .setColor(0x3b82f6)
    .setTimestamp()
    .setFooter({ text: 'Reclutamiento Artic Tempest' });
}

const REPLY_BUTTON_ROW = {
  type: 1,
  components: [
    {
      type: 2,
      style: 5,
      label: 'Responder ahora',
      url: 'https://artictempest.es/zona-raider/reclutamiento',
    },
  ],
};

module.exports = {
  buildChatMessageEmbed,
  buildStatusChangeEmbed,
  buildApplicationCreatedEmbed,
  REPLY_BUTTON_ROW,
  STATUS_LABELS,
  STATUS_COLORS,
};
