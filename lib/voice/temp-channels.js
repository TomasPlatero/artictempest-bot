const mysql = require("mysql2/promise");
const {
  ChannelType,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require("discord.js");

const TTL_MS = 10 * 1000;

function createTempVoiceChannels({ client, logger = console } = {}) {
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
        "SELECT setting_value FROM bot_settings WHERE setting_key = 'temp_voice'",
      );
      const row = rows[0];
      let config = { enabled: false, hubs: [] };
      if (row) {
        const v = row.setting_value;
        let parsed = null;
        if (typeof v === "string") {
          try {
            parsed = JSON.parse(v);
          } catch {
            /* ignore */
          }
        } else if (v && typeof v === "object") {
          parsed = v;
        }
        if (parsed) {
          config = {
            enabled: Boolean(parsed.enabled),
            hubs: Array.isArray(parsed.hubs)
              ? parsed.hubs.filter((h) => h && h.hub_channel_id)
              : [],
          };
        }
      }
      cache = { data: config, at: Date.now() };
      return config;
    } catch (e) {
      logger.error("[TempVoice] Error al cargar config:", e.message);
      return cache.data || { enabled: false, hubs: [] };
    }
  }

  async function getRow(channelId) {
    const [rows] = await getPool().query(
      "SELECT channel_id, owner_id, interface_channel_id, interface_message_id FROM temp_voice_channels WHERE channel_id = ?",
      [channelId],
    );
    return rows[0] ?? null;
  }

  async function deleteInterface(row) {
    if (!row || !row.interface_channel_id || !row.interface_message_id) return;
    const ch = await client.channels
      .fetch(row.interface_channel_id)
      .catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    await ch.messages.delete(row.interface_message_id).catch(() => {});
  }

  function buildButtons(channelId, locked) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tv_name_${channelId}`)
        .setLabel("✏️ Nombre")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tv_limit_${channelId}`)
        .setLabel("👥 Límite")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tv_lock_${channelId}`)
        .setLabel(locked ? "🔓 Abrir" : "🔒 Bloquear")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tv_claim_${channelId}`)
        .setLabel("👑 Reclamar")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tv_delete_${channelId}`)
        .setLabel("🗑️ Eliminar")
        .setStyle(ButtonStyle.Danger),
    );
  }

  async function sendInterface(hub, channel, ownerId) {
    if (!hub.interface_channel_id) return;
    const ch = await client.channels
      .fetch(hub.interface_channel_id)
      .catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const msg = await ch.send({
      content: `🎛️ **${channel.name}** · dueño: <@${ownerId}>`,
      components: [buildButtons(channel.id, false)],
    });
    await getPool().query(
      "UPDATE temp_voice_channels SET interface_channel_id = ?, interface_message_id = ? WHERE channel_id = ?",
      [hub.interface_channel_id, msg.id, channel.id],
    );
  }

  async function deleteTempChannel(guild, channelId) {
    const row = await getRow(channelId);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete().catch(() => {});
    await deleteInterface(row);
    await getPool().query(
      "DELETE FROM temp_voice_channels WHERE channel_id = ?",
      [channelId],
    );
  }

  function isLocked(channel) {
    const everyone = channel.guild.roles.everyone;
    const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
    return overwrite ? overwrite.deny.has(PermissionFlagsBits.Connect) : false;
  }

  async function setLocked(channel, locked) {
    const everyone = channel.guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyone, {
      Connect: locked ? false : null,
    });
  }

  // ---------- voiceStateUpdate ----------
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const config = await loadConfig();
      logger.log(
        "[TempVoice] voiceState:",
        oldState.channelId,
        "->",
        newState.channelId,
        "| enabled:",
        config.enabled,
        "| hubs:",
        (config.hubs || []).map((h) => h.hub_channel_id).join(","),
      );
      if (!config.enabled) return;

      const guild = newState.guild;

      // 1) Borrar el canal temporal que quedó vacío (el usuario salió de él)
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const row = await getRow(oldState.channelId);
        if (row) {
          const channel = await guild.channels
            .fetch(oldState.channelId)
            .catch(() => null);
          if (channel && channel.members.size === 0) {
            await deleteTempChannel(guild, oldState.channelId);
          }
        }
      }

      // 2) Si entró a un hub -> crear canal temporal
      const hub = (config.hubs || []).find(
        (h) => h.hub_channel_id === newState.channelId,
      );
      if (hub && newState.channelId !== oldState.channelId) {
        let member = newState.member;
        if (!member) {
          member = await guild.members.fetch(newState.id).catch(() => null);
        }
        if (!member) {
          logger.error(
            "[TempVoice] no se pudo obtener el miembro:",
            newState.id,
          );
          return;
        }

        const name = (hub.name_template || "🔊 {user}")
          .replace(/\{user\}/g, member.displayName || member.user.username)
          .slice(0, 100);
        const parentId = hub.category_id || newState.channel?.parentId || null;

        const channel = await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: parentId || undefined,
          userLimit: Number(hub.user_limit) || 0,
        });

        await getPool().query(
          "INSERT INTO temp_voice_channels (channel_id, owner_id) VALUES (?, ?)",
          [channel.id, member.id],
        );

        const moved = await member.voice
          .setChannel(channel.id)
          .catch(() => null);
        if (!moved) {
          await channel.delete().catch(() => {});
          await getPool().query(
            "DELETE FROM temp_voice_channels WHERE channel_id = ?",
            [channel.id],
          );
          return;
        }

        await sendInterface(hub, channel, member.id);
      }
    } catch (e) {
      logger.error("[TempVoice] error:", e.message);
    }
  });

  // ---------- interacciones ----------
  client.on("interactionCreate", async (interaction) => {
    try {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "voice"
      ) {
        await handleVoiceCommand(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("tv_")
      ) {
        await handleButton(interaction);
      } else if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith("tv_")
      ) {
        await handleModal(interaction);
      }
    } catch (e) {
      logger.error("[TempVoice] error en interacción:", e.message);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction
            .reply({ content: "Error al procesar.", ephemeral: true })
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }
  });

  async function handleVoiceCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const voice = interaction.member?.voice?.channel;
    if (!voice) {
      return interaction.reply({
        content: "Debes estar en tu canal de voz temporal.",
        ephemeral: true,
      });
    }
    const row = await getRow(voice.id);
    if (!row) {
      return interaction.reply({
        content: "Este canal no es temporal.",
        ephemeral: true,
      });
    }

    const isOwner = row.owner_id === interaction.user.id;

    if (sub === "claim") {
      if (isOwner) {
        return interaction.reply({
          content: "Ya eres el dueño.",
          ephemeral: true,
        });
      }
      if (voice.members.has(row.owner_id)) {
        return interaction.reply({
          content: "El dueño sigue en el canal.",
          ephemeral: true,
        });
      }
      await getPool().query(
        "UPDATE temp_voice_channels SET owner_id = ? WHERE channel_id = ?",
        [interaction.user.id, voice.id],
      );
      return interaction.reply({
        content: "Canal reclamado.",
        ephemeral: true,
      });
    }

    if (!isOwner) {
      return interaction.reply({
        content: "Solo el dueño puede hacer esto.",
        ephemeral: true,
      });
    }

    if (sub === "name") {
      const name = interaction.options.getString("nombre")?.slice(0, 100);
      if (!name) {
        return interaction.reply({
          content: "Nombre inválido.",
          ephemeral: true,
        });
      }
      await voice.setName(name);
      return interaction.reply({
        content: `Canal renombrado a **${name}**.`,
        ephemeral: true,
      });
    }
    if (sub === "limit") {
      const limit = Math.max(
        0,
        Math.min(99, interaction.options.getInteger("limite") ?? 0),
      );
      await voice.setUserLimit(limit);
      return interaction.reply({
        content: limit === 0 ? "Límite quitado." : `Límite: ${limit} usuarios.`,
        ephemeral: true,
      });
    }
    if (sub === "lock") {
      await setLocked(voice, true);
      return interaction.reply({
        content: "Canal bloqueado.",
        ephemeral: true,
      });
    }
    if (sub === "unlock") {
      await setLocked(voice, false);
      return interaction.reply({
        content: "Canal desbloqueado.",
        ephemeral: true,
      });
    }
    if (sub === "delete") {
      await interaction.reply({
        content: "Eliminando canal…",
        ephemeral: true,
      });
      await deleteTempChannel(interaction.guild, voice.id);
    }
  }

  async function handleButton(interaction) {
    const parts = interaction.customId.split("_"); // ["tv", "name", id]
    const action = parts[1];
    const channelId = parts[2];
    const guild = interaction.guild;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const row = await getRow(channelId);
    if (!channel || !row) {
      return interaction.reply({
        content: "El canal ya no existe.",
        ephemeral: true,
      });
    }
    const isOwner = row.owner_id === interaction.user.id;

    if (action === "name" || action === "limit") {
      if (!isOwner) {
        return interaction.reply({
          content: "Solo el dueño puede hacer esto.",
          ephemeral: true,
        });
      }
      const modal = new ModalBuilder()
        .setCustomId(interaction.customId)
        .setTitle(action === "name" ? "Renombrar canal" : "Límite de usuarios");
      const input = new TextInputBuilder()
        .setCustomId("value")
        .setLabel(action === "name" ? "Nuevo nombre" : "Límite (0-99)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(action === "name" ? 100 : 3)
        .setValue(action === "name" ? channel.name : String(channel.userLimit));
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === "lock") {
      if (!isOwner) {
        return interaction.reply({
          content: "Solo el dueño puede hacer esto.",
          ephemeral: true,
        });
      }
      const locked = isLocked(channel);
      await setLocked(channel, !locked);
      return interaction.update({
        components: [buildButtons(channelId, !locked)],
      });
    }

    if (action === "claim") {
      if (isOwner) {
        return interaction.reply({
          content: "Ya eres el dueño.",
          ephemeral: true,
        });
      }
      if (channel.members.has(row.owner_id)) {
        return interaction.reply({
          content: "El dueño sigue en el canal.",
          ephemeral: true,
        });
      }
      await getPool().query(
        "UPDATE temp_voice_channels SET owner_id = ? WHERE channel_id = ?",
        [interaction.user.id, channelId],
      );
      return interaction.reply({
        content: "Canal reclamado.",
        ephemeral: true,
      });
    }

    if (action === "delete") {
      if (!isOwner) {
        return interaction.reply({
          content: "Solo el dueño puede hacer esto.",
          ephemeral: true,
        });
      }
      await interaction.reply({
        content: "Eliminando canal…",
        ephemeral: true,
      });
      await deleteTempChannel(guild, channelId);
    }
  }

  async function handleModal(interaction) {
    const parts = interaction.customId.split("_"); // ["tv", "name", id]
    const action = parts[1];
    const channelId = parts[2];
    const guild = interaction.guild;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const row = await getRow(channelId);
    if (!channel || !row) {
      return interaction.reply({
        content: "El canal ya no existe.",
        ephemeral: true,
      });
    }
    if (row.owner_id !== interaction.user.id) {
      return interaction.reply({
        content: "Solo el dueño puede hacer esto.",
        ephemeral: true,
      });
    }

    const value = interaction.fields.getTextInputValue("value");

    if (action === "name") {
      const name = value.slice(0, 100);
      await channel.setName(name);
      if (row.interface_channel_id && row.interface_message_id) {
        const ch = await client.channels
          .fetch(row.interface_channel_id)
          .catch(() => null);
        if (ch && ch.isTextBased()) {
          await ch.messages
            .edit(row.interface_message_id, {
              content: `🎛️ **${name}** · dueño: <@${row.owner_id}>`,
            })
            .catch(() => {});
        }
      }
      return interaction.reply({
        content: `Canal renombrado a **${name}**.`,
        ephemeral: true,
      });
    }

    if (action === "limit") {
      const limit = Math.max(0, Math.min(99, Number(value) || 0));
      await channel.setUserLimit(limit);
      return interaction.reply({
        content: limit === 0 ? "Límite quitado." : `Límite: ${limit} usuarios.`,
        ephemeral: true,
      });
    }
  }

  // ---------- ready: registrar /voice + cleanup ----------
  client.once("clientReady", async (readyClient) => {
    try {
      const command = new SlashCommandBuilder()
        .setName("voice")
        .setDescription("Gestiona tu canal de voz temporal")
        .addSubcommand((s) =>
          s
            .setName("name")
            .setDescription("Renombra tu canal")
            .addStringOption((o) =>
              o
                .setName("nombre")
                .setDescription("Nuevo nombre")
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("limit")
            .setDescription("Cambia el límite de usuarios")
            .addIntegerOption((o) =>
              o
                .setName("limite")
                .setDescription("0-99 (0 = sin límite)")
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName("lock").setDescription("Bloquea tu canal"),
        )
        .addSubcommand((s) =>
          s.setName("unlock").setDescription("Desbloquea tu canal"),
        )
        .addSubcommand((s) =>
          s
            .setName("claim")
            .setDescription("Reclama el canal si el dueño se fue"),
        )
        .addSubcommand((s) =>
          s.setName("delete").setDescription("Elimina tu canal"),
        );

      for (const guild of readyClient.guilds.cache.values()) {
        try {
          const existing = await guild.commands
            .fetch()
            .then((cmds) => cmds.find((c) => c.name === "voice"));
          if (existing) await guild.commands.edit(existing.id, command);
          else await guild.commands.create(command);
        } catch (e) {
          logger.error("[TempVoice] error registrando /voice:", e.message);
        }
      }
    } catch (e) {
      logger.error("[TempVoice] error registrando /voice:", e.message);
    }

    try {
      const [rows] = await getPool().query(
        "SELECT channel_id, owner_id, interface_channel_id, interface_message_id FROM temp_voice_channels",
      );
      for (const row of rows) {
        const channel = await readyClient.channels
          .fetch(row.channel_id)
          .catch(() => null);
        if (!channel || channel.members.size === 0) {
          if (channel) await channel.delete().catch(() => {});
          await deleteInterface(row);
          await getPool().query(
            "DELETE FROM temp_voice_channels WHERE channel_id = ?",
            [row.channel_id],
          );
        }
      }
    } catch (e) {
      logger.error("[TempVoice] error en cleanup:", e.message);
    }
  });

  return {};
}

module.exports = { createTempVoiceChannels };
