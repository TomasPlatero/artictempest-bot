const mysql = require("mysql2/promise");

const TTL_MS = 60 * 1000;

function createCommandsLoader({ logger = console } = {}) {
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

  async function loadCommands() {
    if (cache.data.length > 0 && Date.now() - cache.at < TTL_MS) {
      return cache.data;
    }
    try {
      const [rows] = await getPool().query(
        "SELECT name, enabled, config FROM commands WHERE enabled = 1",
      );
      const commands = rows.map((row) => ({
        name: row.name,
        enabled: row.enabled,
        config:
          typeof row.config === "string" ? JSON.parse(row.config) : row.config,
      }));
      cache = { data: commands, at: Date.now() };
      return commands;
    } catch (error) {
      logger.error("[Commands] Error al cargar comandos:", error.message);
      return cache.data;
    }
  }

  return { loadCommands };
}

module.exports = { createCommandsLoader };
