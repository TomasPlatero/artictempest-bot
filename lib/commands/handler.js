const { PermissionFlagsBits } = require("discord.js");
const {
  PURGE_OPTION_NAME,
  PURGE_MAX_AMOUNT,
  clampAmount,
  createPurgePlan,
} = require("./purge");

const cooldowns = new Map(); // nombre -> Map(userId -> timestamp)

function createCommandHandler({ client, loadCommands, logger = console }) {
  async function findCommand(name) {
    const commands = await loadCommands();
    return commands.find((c) => c.name === name) || null;
  }

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    let command;
    try {
      command = await findCommand(interaction.commandName);
    } catch (e) {
      logger.error("[Commands] Error buscando comando:", e.message);
      return;
    }
    if (!command) return;

    const config = command.config || {};
    const member = interaction.member;
    const memberRoles =
      member && member.roles && member.roles.cache
        ? [...member.roles.cache.keys()]
        : [];

    // Permisos por rol
    const allowed = config.allowed_roles || [];
    const denied = config.denied_roles || [];
    const deniedRole = denied.some((rid) => memberRoles.includes(rid));
    const notAllowed =
      allowed.length && !allowed.some((rid) => memberRoles.includes(rid));
    if (deniedRole || notAllowed) {
      return interaction.reply({
        content: "No tienes permiso para usar este comando.",
        ephemeral: true,
      });
    }

    // Cooldown
    const cooldownSec = config.cooldown_seconds || 0;
    if (cooldownSec > 0) {
      const userCooldowns = cooldowns.get(command.name) || new Map();
      const last = userCooldowns.get(interaction.user.id) || 0;
      const now = Date.now();
      if (now - last < cooldownSec * 1000) {
        const remaining = Math.ceil((cooldownSec * 1000 - (now - last)) / 1000);
        return interaction.reply({
          content: `Espera ${remaining}s antes de usar este comando de nuevo.`,
          ephemeral: true,
        });
      }
      userCooldowns.set(interaction.user.id, now);
      cooldowns.set(command.name, userCooldowns);
    }

    const actions = config.actions || [];
    // La acción de purga tiene su propio flujo (pide la cantidad como opción y
    // borra mensajes), así que no pasa por el bucle de acciones normales.
    if (actions.some((action) => action.type === "purge_messages")) {
      await handlePurge({ interaction, command, logger });
      return;
    }

    try {
      for (const action of actions) {
        if (action.type === "send_message") {
          const channel = await client.channels
            .fetch(action.channel_id)
            .catch(() => null);
          if (!channel || !channel.isTextBased()) continue;
          await channel.send({
            content: renderContent(action.content, interaction),
          });
        } else if (action.type === "send_dm") {
          try {
            await interaction.user.send({
              content: renderContent(action.content, interaction),
            });
          } catch {
            /* DMs cerrados */
          }
        } else if (
          action.type === "give_role" ||
          action.type === "remove_role"
        ) {
          if (!member || !action.role_id) continue;
          try {
            if (action.type === "give_role")
              await member.roles.add(action.role_id);
            else await member.roles.remove(action.role_id);
          } catch {
            /* rol por encima del bot */
          }
        }
      }

      await interaction
        .reply({ content: "✓", ephemeral: true })
        .catch(() => {});
    } catch (error) {
      logger.error(
        `[Commands] Error ejecutando "${command.name}":`,
        error.message,
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "Hubo un error al ejecutar el comando.",
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  });

  return {};
}

async function handlePurge({ interaction, command, logger }) {
  const amount = clampAmount(interaction.options.getInteger(PURGE_OPTION_NAME));
  if (!amount) {
    await interaction
      .reply({
        content: `Indica cuántos mensajes borrar (1-${PURGE_MAX_AMOUNT}).`,
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction
      .reply({
        content:
          "Necesitas el permiso «Gestionar mensajes» para usar este comando.",
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.messages?.fetch !== "function") {
    await interaction
      .reply({
        content: "No puedo leer los mensajes de este canal.",
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  const me = interaction.guild?.members?.me;
  const botPermissions = me ? channel.permissionsFor?.(me) : null;
  if (
    botPermissions &&
    !botPermissions.has(PermissionFlagsBits.ManageMessages)
  ) {
    await interaction
      .reply({
        content: "Me falta el permiso «Gestionar mensajes» en este canal.",
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const fetched = await channel.messages.fetch({ limit: amount });
    const { deletable, tooOld, pinned } = createPurgePlan([
      ...fetched.values(),
    ]);
    if (deletable.length) await channel.bulkDelete(deletable, true);

    const lines = [`🧹 Se borraron ${deletable.length} mensaje(s).`];
    if (tooOld.length) {
      lines.push(
        `⏳ ${tooOld.length} omitido(s) por tener más de 14 días.`,
      );
    }
    if (pinned.length) {
      lines.push(`📌 ${pinned.length} omitido(s) por estar fijado(s).`);
    }
    if (fetched.size === 0) lines.push("No encontré mensajes para borrar.");

    await interaction.editReply({ content: lines.join("\n") });
  } catch (error) {
    logger.error(
      `[Commands] Error borrando mensajes de "${command.name}":`,
      error.message,
    );
    await interaction
      .editReply({ content: "Hubo un error al borrar los mensajes." })
      .catch(() => {});
  }
}

function renderContent(template, interaction) {
  if (!template) return "";
  const user = interaction.user;
  const guild = interaction.guild;
  const channel = interaction.channel;

  return template
    .replace(/\{user\.mention\}/g, `<@${user.id}>`)
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{user\.name\}/g, user.username)
    .replace(/\{user\.id\}/g, user.id)
    .replace(/\{server\.name\}/g, guild?.name || "")
    .replace(/\{channel\.name\}/g, channel?.name || "")
    .replace(/\{channel\}/g, channel ? `<#${channel.id}>` : "");
}

module.exports = { createCommandHandler };
