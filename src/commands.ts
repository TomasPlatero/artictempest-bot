import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Muestra el estado básico del clan y reclutamiento.'),
  new SlashCommandBuilder()
    .setName('progreso')
    .setDescription('Muestra el progreso de raid de Artic Tempest.'),
  new SlashCommandBuilder()
    .setName('reclutamiento')
    .setDescription('Muestra el estado actual del reclutamiento.'),
  new SlashCommandBuilder()
    .setName('web')
    .setDescription('Enlaces rápidos a la web de Artic Tempest.'),
  new SlashCommandBuilder()
    .setName('applys')
    .setDescription('Lista los applys activos en la web.')
    .addIntegerOption((option) =>
      option.setName('limit').setDescription('Número máximo de applys').setRequired(false).setMinValue(1).setMaxValue(100),
    )
    .addStringOption((option) =>
      option.setName('cursor').setDescription('Cursor para paginar').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Opera sobre un apply.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('messages')
        .setDescription('Lee mensajes de un apply.')
        .addStringOption((option) =>
          option.setName('apply_id').setDescription('ID del apply').setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('limit').setDescription('Número máximo de mensajes').setRequired(false).setMinValue(1).setMaxValue(100),
        )
        .addStringOption((option) =>
          option.setName('cursor').setDescription('Cursor para paginar').setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reply')
        .setDescription('Envía un mensaje al chat del apply.')
        .addStringOption((option) =>
          option.setName('apply_id').setDescription('ID del apply').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('content').setDescription('Mensaje a enviar').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Cambia el estado del apply.')
        .addStringOption((option) =>
          option.setName('apply_id').setDescription('ID del apply').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('state')
            .setDescription('Nuevo estado')
            .setRequired(true)
            .addChoices(
              { name: 'pending', value: 'pending' },
              { name: 'reviewing', value: 'reviewing' },
              { name: 'interview', value: 'interview' },
              { name: 'simulated', value: 'simulated' },
              { name: 'accepted', value: 'accepted' },
              { name: 'rejected', value: 'rejected' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('link')
        .setDescription('Muestra el vínculo Discord ↔ web del apply.')
        .addStringOption((option) =>
          option.setName('apply_id').setDescription('ID del apply').setRequired(true),
        ),
    ),
].map((command) => command.toJSON());
