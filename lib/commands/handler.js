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

    try {
      const actions = config.actions || [];
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
