function createAutomationExecutor({
  client,
  loadAutomations,
  logger = console,
}) {
  async function runForEvent(eventType, context) {
    let automations;
    try {
      automations = await loadAutomations();
    } catch {
      return;
    }

    for (const automation of automations) {
      try {
        const { trigger, conditions, actions } = automation.config || {};
        if (!trigger || trigger.type !== eventType) continue;
        if (!evaluateTrigger(trigger, context)) continue;
        if (!evaluateConditions(conditions || [], context)) continue;

        for (const action of actions || []) {
          await executeAction(client, action, context);
        }
      } catch (error) {
        logger.error(
          `[Automations] Error en "${automation.name}":`,
          error.message,
        );
      }
    }
  }

  client.on("messageCreate", (message) => {
    if (message.author.bot) return;
    void runForEvent("sends_message", {
      type: "sends_message",
      message,
      user: message.author,
      channel: message.channel,
      guild: message.guild,
      member: message.member,
    });
  });

  client.on("guildMemberAdd", (member) => {
    void runForEvent("joins_server", {
      type: "joins_server",
      user: member.user,
      member,
      guild: member.guild,
    });
  });

  client.on("guildMemberRemove", (member) => {
    void runForEvent("leaves_server", {
      type: "leaves_server",
      user: member.user,
      member,
      guild: member.guild,
    });
  });

  return {};
}

function evaluateTrigger(trigger, context) {
  if (trigger.type === "sends_message" && trigger.channel_id) {
    return context.channel && context.channel.id === trigger.channel_id;
  }
  return true;
}

function evaluateConditions(conditions, context) {
  for (const cond of conditions) {
    if (cond.type === "message_contains") {
      const content = (context.message?.content || "").toLowerCase();
      const values = (cond.values || []).map((v) => String(v).toLowerCase());
      if (values.length && !values.some((v) => content.includes(v)))
        return false;
    } else if (cond.type === "message_is_exactly") {
      const content = (context.message?.content || "").trim().toLowerCase();
      const values = (cond.values || []).map((v) =>
        String(v).trim().toLowerCase(),
      );
      if (values.length && !values.includes(content)) return false;
    } else if (cond.type === "user_has_role") {
      const roleIds = cond.role_ids || [];
      if (!roleIds.length) continue;
      const memberRoles = [];
      if (
        context.member &&
        context.member.roles &&
        context.member.roles.cache
      ) {
        for (const role of context.member.roles.cache.values()) {
          memberRoles.push(role.id);
        }
      }
      if (!roleIds.some((rid) => memberRoles.includes(rid))) return false;
    }
  }
  return true;
}

async function executeAction(client, action, context) {
  if (!action) return;

  if (action.type === "send_message") {
    const channelId = action.channel_id || context.channel?.id;
    const channel = channelId
      ? await client.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel || !channel.isTextBased()) return;
    const content = resolveRoleMentions(
      renderContent(action.content, context),
      context.guild,
    );
    if (content) await channel.send({ content });
  } else if (action.type === "reply") {
    const message = context.message;
    if (!message) return;
    const content = resolveRoleMentions(
      renderContent(action.content, context),
      context.guild,
    );
    await message.reply({ content: content || undefined });
  } else if (action.type === "repost") {
    const target = await client.channels
      .fetch(action.channel_id)
      .catch(() => null);
    const message = context.message;
    if (!target || !message) return;

    let content = "";
    if (action.content) {
      content = resolveRoleMentions(
        renderContent(action.content, context),
        context.guild,
      );
    }

    const embed = {};
    if (action.title) embed.title = renderContent(action.title, context);

    const colorHex = String(action.color || "#2f80ed").replace("#", "");
    const colorInt = parseInt(colorHex, 16);
    embed.color = Number.isNaN(colorInt) ? 0x2f80ed : colorInt;

    if (action.show_author !== false) {
      embed.author = {
        name: message.member?.displayName || message.author.username,
        icon_url: message.author.displayAvatarURL(),
      };
    }

    if (action.show_content !== false) {
      const text = message.content?.trim();
      if (text) embed.description = text.slice(0, 4096);
    }

    const fields = [];
    if (action.show_author !== false) {
      fields.push({
        name: "Autor",
        value: `<@${message.author.id}>`,
        inline: true,
      });
    }
    if (action.show_timestamp !== false) {
      fields.push({
        name: "Fecha",
        value: formatDate(new Date()),
        inline: false,
      });
    }
    if (action.show_attachments !== false) {
      const attachments = [...message.attachments.values()];
      if (attachments.length) {
        fields.push({
          name: "Adjuntos",
          value: attachments
            .map((a) => `[${a.name || "archivo"}](${a.url})`)
            .join("\n")
            .slice(0, 1024),
        });
      }
    }
    if (fields.length) embed.fields = fields;

    await target.send({ content: content || undefined, embeds: [embed] });
  } else if (action.type === "delete_message") {
    if (context.message) await context.message.delete().catch(() => {});
  } else if (action.type === "give_role" || action.type === "take_role") {
    const member = context.member;
    if (!member || !action.role_id) return;
    try {
      if (action.type === "give_role") await member.roles.add(action.role_id);
      else await member.roles.remove(action.role_id);
    } catch {
      // rol por encima del bot u otro error: ignorar
    }
  }
}

function renderContent(template, context) {
  if (!template) return "";
  const user = context.user;
  const guild = context.guild;
  const channel = context.channel;
  const message = context.message;

  return template
    .replace(/\{user\.mention\}/g, user ? `<@${user.id}>` : "")
    .replace(/\{user\}/g, user ? `<@${user.id}>` : "")
    .replace(/\{user\.name\}/g, user?.username || "")
    .replace(/\{user\.id\}/g, user?.id || "")
    .replace(/\{server\.name\}/g, guild?.name || "")
    .replace(/\{channel\.name\}/g, channel?.name || "")
    .replace(/\{channel\}/g, channel ? `<#${channel.id}>` : "")
    .replace(/\{message\}/g, message?.content || "");
}

function formatDate(date) {
  const formatted = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function resolveRoleMentions(content, guild) {
  if (!content || !guild || !guild.roles) return content;
  const roles = guild.roles.cache ? [...guild.roles.cache.values()] : [];
  const sorted = roles.sort((a, b) => b.name.length - a.name.length);
  let result = content;
  for (const role of sorted) {
    if (role.name === "@everyone") continue;
    const escaped = role.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`@${escaped}(?![\\w])`, "g"),
      `<@&${role.id}>`,
    );
  }
  return result;
}

module.exports = { createAutomationExecutor };
