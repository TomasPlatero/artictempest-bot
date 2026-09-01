const mysql = require("mysql2/promise");
const { AuditLogEvent } = require("discord.js");

const TTL_MS = 10 * 1000;

function createAuditLogger({ client, logger = console } = {}) {
  let pool = null;
  let cache = { data: null, at: 0 };

  function getPool() {
    if (!pool) {
      pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 5,
      });
    }
    return pool;
  }

  async function loadConfig() {
    if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
    try {
      const [rows] = await getPool().query(
        "SELECT setting_value FROM bot_settings WHERE setting_key = 'audit_log'",
      );
      const row = rows[0];
      let config = { enabled: false, channel_id: "", events: [] };
      if (row) {
        const v = row.setting_value;
        if (typeof v === "string") {
          try {
            config = JSON.parse(v);
          } catch {
            /* ignore */
          }
        } else {
          config = v || config;
        }
      }
      cache = { data: config, at: Date.now() };
      return config;
    } catch (e) {
      logger.error("[Audit] Error al cargar config:", e.message);
      return cache.data || { enabled: false, channel_id: "", events: [] };
    }
  }

  async function send(event, embed, channelId) {
    const config = await loadConfig();
    logger.log(
      "[Audit] evento:",
      event,
      "| enabled:",
      config.enabled,
      "| channel:",
      config.channel_id,
      "| incluye:",
      (config.events || []).includes(event),
    );
    if (!config.enabled || !config.channel_id) return;
    if (!(config.events || []).includes(event)) return;
    if (channelId && (config.excluded_channels || []).includes(channelId))
      return;
    const channel = await client.channels
      .fetch(config.channel_id)
      .catch((e) => {
        logger.error("[Audit] no se pudo obtener el canal:", e.message);
        return null;
      });
    if (!channel || !channel.isTextBased()) {
      logger.error("[Audit] canal inválido o no es de texto");
      return;
    }
    await channel
      .send({ embeds: [embed] })
      .then(() => logger.log("[Audit] enviado:", event))
      .catch((e) => logger.error("[Audit] error al enviar:", e.message));
  }

  function now() {
    return new Date().toISOString();
  }

  // Detecta si una salida fue por kick/ban (audit log) o fue voluntaria.
  async function detectRemovalType(member) {
    try {
      const logs = await member.guild.fetchAuditLogs({ limit: 10 });
      const entries = logs.entries.filter(
        (e) =>
          e.target &&
          e.target.id === member.id &&
          Date.now() - e.createdTimestamp < 15000,
      );
      if (entries.some((e) => e.action === AuditLogEvent.MemberBanAdd))
        return "ban";
      if (entries.some((e) => e.action === AuditLogEvent.MemberKick))
        return "kick";
      return "leave";
    } catch {
      return "leave";
    }
  }

  function overwritesChanged(oldCh, newCh) {
    const a = oldCh.permissionOverwrites?.cache;
    const b = newCh.permissionOverwrites?.cache;
    if (!a || !b) return false;
    if (a.size !== b.size) return true;
    for (const [id, o] of a) {
      const n = b.get(id);
      if (!n) return true;
      if (
        o.allow.bitfield !== n.allow.bitfield ||
        o.deny.bitfield !== n.deny.bitfield
      )
        return true;
    }
    return false;
  }

  // ---------- Miembros ----------
  client.on("guildMemberAdd", (member) => {
    void send("member_join", {
      color: 0x2ecc71,
      author: { name: `${member.user.username} se unió al servidor` },
      description: `<@${member.user.id}>`,
      footer: {
        text: `Cuenta creada: ${member.user.createdAt.toISOString().slice(0, 10)}`,
      },
      timestamp: now(),
    });
  });

  client.on("guildMemberRemove", async (member) => {
    const type = await detectRemovalType(member);
    if (type === "ban") return; // guildBanAdd lo registra
    if (type === "kick") {
      void send("member_kick", {
        color: 0xe67e22,
        author: { name: `${member.user.username} fue expulsado (kick)` },
        description: `<@${member.user.id}>`,
        timestamp: now(),
      });
    } else {
      void send("member_leave", {
        color: 0xe74c3c,
        author: { name: `${member.user.username} salió del servidor` },
        description: `<@${member.user.id}>`,
        timestamp: now(),
      });
    }
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
      void send("nickname_change", {
        color: 0xf1c40f,
        title: "Cambio de apodo",
        description: `${newMember.user.username}: \`${oldMember.nickname || "—"}\` → \`${newMember.nickname || "—"}\``,
        timestamp: now(),
      });
    }

    const oldT = oldMember.communicationDisabledUntil?.getTime() ?? 0;
    const newT = newMember.communicationDisabledUntil?.getTime() ?? 0;
    if (oldT !== newT) {
      void send("timeout", {
        color: 0x9b59b6,
        title: newT > Date.now() ? "Timeout añadido" : "Timeout quitado",
        description: `<@${newMember.user.id}>${
          newT > Date.now()
            ? ` hasta ${new Date(newT).toISOString().slice(0, 16)}`
            : ""
        }`,
        timestamp: now(),
      });
    }

    const added = newMember.roles.cache.filter(
      (r) => !oldMember.roles.cache.has(r.id),
    );
    const removed = oldMember.roles.cache.filter(
      (r) => !newMember.roles.cache.has(r.id),
    );
    if (added.size) {
      void send("role_given", {
        color: 0x2ecc71,
        title: "Rol asignado",
        description: `<@${newMember.user.id}> recibió: ${added.map((r) => `<@&${r.id}>`).join(", ")}`,
        timestamp: now(),
      });
    }
    if (removed.size) {
      void send("role_removed", {
        color: 0xe74c3c,
        title: "Rol quitado",
        description: `<@${newMember.user.id}> perdió: ${removed.map((r) => `<@&${r.id}>`).join(", ")}`,
        timestamp: now(),
      });
    }
  });

  // ---------- Mensajes ----------
  client.on("messageDelete", async (message) => {
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }
    if (message.author?.bot) return;
    void send(
      "message_delete",
      {
        color: 0xe74c3c,
        author: {
          name: `Mensaje eliminado de ${message.author?.username || "?"}`,
        },
        description: (message.content || "").slice(0, 1000) || "*[sin texto]*",
        footer: { text: message.channel?.name ? `#${message.channel.name}` : "" },
        timestamp: now(),
      },
      message.channel?.id,
    );
  });

  client.on("messageUpdate", async (oldMessage, newMessage) => {
    if (newMessage.partial) {
      try {
        await newMessage.fetch();
      } catch {
        return;
      }
    }
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    void send(
      "message_edit",
      {
        color: 0xf1c40f,
        author: {
          name: `Mensaje editado de ${newMessage.author?.username || "?"}`,
        },
        fields: [
          {
            name: "Antes",
            value: (oldMessage.content || "*[sin texto]*").slice(0, 1000),
          },
          {
            name: "Después",
            value: (newMessage.content || "*[sin texto]*").slice(0, 1000),
          },
        ],
        footer: {
          text: newMessage.channel?.name ? `#${newMessage.channel.name}` : "",
        },
        timestamp: now(),
      },
      newMessage.channel?.id,
    );
  });

  // ---------- Baneos ----------
  client.on("guildBanAdd", (ban) => {
    void send("ban", {
      color: 0xe74c3c,
      author: { name: `${ban.user?.username || "?"} fue baneado` },
      description: `<@${ban.user?.id}>`,
      timestamp: now(),
    });
  });

  client.on("guildBanRemove", (ban) => {
    void send("unban", {
      color: 0x2ecc71,
      author: { name: `${ban.user?.username || "?"} fue desbaneado` },
      description: `<@${ban.user?.id}>`,
      timestamp: now(),
    });
  });

  // ---------- Canales ----------
  client.on("channelCreate", (channel) => {
    void send(
      "channel_create",
      {
        color: 0x2ecc71,
        title: "Canal creado",
        description: `${channel.name} (${channel.type})`,
        timestamp: now(),
      },
      channel.id,
    );
  });

  client.on("channelDelete", (channel) => {
    void send(
      "channel_delete",
      {
        color: 0xe74c3c,
        title: "Canal eliminado",
        description: `${channel.name}`,
        timestamp: now(),
      },
      channel.id,
    );
  });

  client.on("channelUpdate", (oldCh, newCh) => {
    if (overwritesChanged(oldCh, newCh)) {
      void send(
        "channel_permissions",
        {
          color: 0x9b59b6,
          title: "Permisos de canal actualizados",
          description: `#${newCh.name}`,
          timestamp: now(),
        },
        newCh.id,
      );
    } else if (oldCh.name !== newCh.name) {
      void send(
        "channel_update",
        {
          color: 0xf1c40f,
          title: "Canal actualizado",
          description: `#${oldCh.name} → #${newCh.name}`,
          timestamp: now(),
        },
        newCh.id,
      );
    }
  });

  // ---------- Hilos ----------
  client.on("threadCreate", (thread) => {
    void send(
      "thread_create",
      {
        color: 0x2ecc71,
        title: "Hilo creado",
        description: `🧵 ${thread.name}`,
        timestamp: now(),
      },
      thread.parentId,
    );
  });

  client.on("threadDelete", (thread) => {
    void send(
      "thread_delete",
      {
        color: 0xe74c3c,
        title: "Hilo eliminado",
        description: `🧵 ${thread.name}`,
        timestamp: now(),
      },
      thread.parentId,
    );
  });

  client.on("threadUpdate", (oldT, newT) => {
    if (oldT.name !== newT.name) {
      void send(
        "thread_update",
        {
          color: 0xf1c40f,
          title: "Hilo actualizado",
          description: `🧵 ${oldT.name} → ${newT.name}`,
          timestamp: now(),
        },
        newT.parentId,
      );
    }
  });

  // ---------- Roles ----------
  client.on("roleCreate", (role) => {
    void send("role_create", {
      color: 0x2ecc71,
      title: "Rol creado",
      description: `<@&${role.id}>`,
      timestamp: now(),
    });
  });

  client.on("roleDelete", (role) => {
    void send("role_delete", {
      color: 0xe74c3c,
      title: "Rol eliminado",
      description: `@${role.name}`,
      timestamp: now(),
    });
  });

  client.on("roleUpdate", (oldR, newR) => {
    if (oldR.name !== newR.name) {
      void send("role_update", {
        color: 0xf1c40f,
        title: "Rol actualizado",
        description: `@${oldR.name} → @${newR.name}`,
        timestamp: now(),
      });
    }
  });

  // ---------- Servidor ----------
  client.on("guildUpdate", (_oldG, newG) => {
    void send("guild_update", {
      color: 0xf1c40f,
      title: "Servidor actualizado",
      description: `${newG.name}`,
      timestamp: now(),
    });
  });

  // ---------- Invitaciones ----------
  client.on("inviteCreate", (invite) => {
    void send("invite", {
      color: 0x2ecc71,
      title: "Invitación creada",
      description: `Código \`${invite.code}\` por ${invite.inviter?.username || "?"}`,
      timestamp: now(),
    });
  });

  client.on("inviteDelete", (invite) => {
    void send("invite", {
      color: 0xe74c3c,
      title: "Invitación eliminada",
      description: `Código \`${invite.code}\``,
      timestamp: now(),
    });
  });

  // ---------- Voz ----------
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (
      oldState.serverMute !== newState.serverMute ||
      oldState.serverDeaf !== newState.serverDeaf
    ) {
      const muted = newState.serverMute || newState.serverDeaf;
      void send(
        "voice_mute",
        {
          color: 0x9b59b6,
          title: muted ? "Muteado / Ensordecido" : "Unmuteado",
          description: `<@${newState.id}>`,
          timestamp: now(),
        },
        newState.channelId || oldState.channelId,
      );
    }

    if (!oldState.channelId && newState.channelId) {
      void send(
        "voice_join",
        {
          color: 0x2ecc71,
          title: "Entró a un canal de voz",
          description: `<@${newState.id}> → ${newState.channel?.name || ""}`,
          timestamp: now(),
        },
        newState.channelId,
      );
    } else if (oldState.channelId && !newState.channelId) {
      void send(
        "voice_leave",
        {
          color: 0xe74c3c,
          title: "Salió de un canal de voz",
          description: `<@${newState.id}> ← ${oldState.channel?.name || ""}`,
          timestamp: now(),
        },
        oldState.channelId,
      );
    } else if (
      oldState.channelId &&
      newState.channelId &&
      oldState.channelId !== newState.channelId
    ) {
      void send(
        "voice_switch",
        {
          color: 0xf1c40f,
          title: "Cambió de canal de voz",
          description: `<@${newState.id}>: ${oldState.channel?.name || ""} → ${newState.channel?.name || ""}`,
          timestamp: now(),
        },
        newState.channelId,
      );
    }
  });

  return {};
}

module.exports = { createAuditLogger };
