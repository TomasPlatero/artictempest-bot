const mysql = require("mysql2/promise");

const TTL_MS = 60 * 1000; // 1 minuto de caché

function createAutomationsLoader({ logger = console } = {}) {
  let pool = null;
  let cache = { data: [], at: 0 };

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

  async function loadAutomations() {
    if (cache.data.length > 0 && Date.now() - cache.at < TTL_MS) {
      return cache.data;
    }

    try {
      const [rows] = await getPool().query(
        "SELECT id, name, enabled, config FROM automations WHERE enabled = 1",
      );
      const automations = rows.map((row) => ({
        id: row.id,
        name: row.name,
        config:
          typeof row.config === "string" ? JSON.parse(row.config) : row.config,
      }));
      cache = { data: automations, at: Date.now() };
      return automations;
    } catch (error) {
      logger.error(
        "[Automations] Error al cargar automatizaciones:",
        error.message,
      );
      return cache.data; // devolver lo último conocido
    }
  }

  return { loadAutomations };
}

module.exports = { createAutomationsLoader };
