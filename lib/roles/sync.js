const GUILD_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Sincronización de roles Discord -> web.
 *
 * Empuja la lista de miembros del guild (con sus roles) a la API de la web
 * (`POST /api/bot/sync-roles`), que se encarga de mapear y escribir en Supabase.
 *
 * Dos disparadores:
 *  - `guildMemberUpdate`: actualiza un miembro al instante cuando cambia en Discord.
 *  - `clientReady` + intervalo (15 min): full sync para corregir lo que se haya perdido.
 */
function createRoleSync({ client, guildId, webBaseUrl, webApiToken, logger = console }) {
  let timer = null;
  const inFlight = new Set();

  function memberPayload(member) {
    return {
      discordUserId: member.user.id,
      roles: member.roles.cache.map((role) => role.id),
    };
  }

  async function push(members) {
    const url = `${webBaseUrl.replace(/\/$/, "")}/api/bot/sync-roles`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${webApiToken}`,
      },
      body: JSON.stringify({ members }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json();
  }

  async function syncAll() {
    const guild = guildId
      ? client.guilds.cache.get(guildId)
      : client.guilds.cache.first();
    if (!guild) {
      logger.warn("[RoleSync] guild not found; skipping full sync");
      return;
    }
    try {
      const membersCollection = await guild.members.fetch();
      const members = membersCollection.map(memberPayload);
      const result = await push(members);
      logger.log(
        `[RoleSync] full sync: ${result.received} members, ${result.updated} updated`,
      );
    } catch (error) {
      logger.error(`[RoleSync] full sync failed: ${error.message}`);
    }
  }

  async function syncMember(member) {
    const userId = member?.user?.id;
    if (!userId) return;
    if (inFlight.has(userId)) return;
    inFlight.add(userId);
    try {
      const result = await push([memberPayload(member)]);
      logger.log(`[RoleSync] ${member.user.tag}: ${result.updated} updated`);
    } catch (error) {
      logger.error(`[RoleSync] member ${userId} failed: ${error.message}`);
    } finally {
      inFlight.delete(userId);
    }
  }

  function start() {
    client.on("guildMemberUpdate", (_oldMember, newMember) => {
      void syncMember(newMember);
    });

    if (client.isReady()) {
      void syncAll();
      timer = setInterval(() => void syncAll(), GUILD_SYNC_INTERVAL_MS);
    } else {
      client.once("clientReady", () => {
        void syncAll();
        timer = setInterval(() => void syncAll(), GUILD_SYNC_INTERVAL_MS);
      });
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, syncAll, syncMember };
}

module.exports = { createRoleSync };
