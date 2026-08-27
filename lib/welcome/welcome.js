const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const sharp = require("sharp");

const TTL_MS = 10 * 1000;
const W = 890;
const H = 434;
const AVATAR = 150;
const AVATAR_TOP = 60;
const TITLE_Y = 255;
const SUBTITLE_Y = 325;
const OVERLAY_PAD_X = 30;
const OVERLAY_PAD_Y = 18;
const OVERLAY_RADIUS = 18;

const FONT_FILE = path.join(__dirname, "../../assets/fonts/Discord.ttf");

let discordFamily = null;

function getFontFamily(filepath) {
  try {
    const buf = fs.readFileSync(filepath);
    const numTables = buf.readUInt16BE(4);
    let nameOff = null;
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      if (buf.toString("ascii", off, off + 4) === "name") {
        nameOff = buf.readUInt32BE(off + 8);
      }
    }
    if (nameOff == null) return null;
    const count = buf.readUInt16BE(nameOff + 2);
    const strOff = buf.readUInt16BE(nameOff + 4);
    let family = null;
    let typo = null;
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const platformID = buf.readUInt16BE(rec);
      const nameID = buf.readUInt16BE(rec + 6);
      const length = buf.readUInt16BE(rec + 8);
      const offset = buf.readUInt16BE(rec + 10);
      const sOff = nameOff + strOff + offset;
      const bytes = buf.slice(sOff, sOff + length);
      let str = "";
      if (platformID === 0 || platformID === 3) {
        for (let j = 0; j + 1 < bytes.length; j += 2) {
          str += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
        }
      } else {
        str = bytes.toString("latin1");
      }
      if (nameID === 16 && !typo) typo = str;
      if (nameID === 1 && !family) family = str;
    }
    return typo || family || null;
  } catch {
    return null;
  }
}

function resolveFamily(font) {
  if (font === "Discord") {
    if (!discordFamily) {
      discordFamily = getFontFamily(FONT_FILE) || "sans-serif";
    }
    return discordFamily;
  }
  const first = String(font)
    .split(",")[0]
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
  return first || "sans-serif";
}

function hexToRgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function createWelcomeSystem({ client, logger = console } = {}) {
  let pool = null;
  let cache = { data: null, at: 0 };

  const DEFAULT_CONFIG = {
    enabled: false,
    channel_id: "",
    message: "¡Bienvenido {user} a {server}!",
    card_enabled: true,
    card_title: "¡Bienvenido {username}!",
    card_subtitle: "Esperamos que la pases bien",
    background_color: "#1e293b",
    text_color: "#ffffff",
    subtitle_color: "#cbd5e1",
    text_align: "center",
    title_font_size: 46,
    subtitle_font_size: 26,
    background_image_url: "",
    font_family: "sans-serif",
    avatar_shape: "circle",
    avatar_border_color: "#ffffff",
    avatar_border_width: 0,
    overlay_color: "#000000",
    overlay_opacity: 0,
  };

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
        "SELECT setting_value FROM bot_settings WHERE setting_key = 'welcome'",
      );
      const row = rows[0];
      let config = { ...DEFAULT_CONFIG };
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
        if (parsed) config = { ...config, ...parsed };
      }
      cache = { data: config, at: Date.now() };
      return config;
    } catch (e) {
      logger.error("[Welcome] Error al cargar config:", e.message);
      return cache.data || { ...DEFAULT_CONFIG };
    }
  }

  function replacePlaceholders(text, member) {
    if (!text) return "";
    return String(text)
      .replace(/\{user\}/g, `<@${member.user.id}>`)
      .replace(/\{username\}/g, member.user.username)
      .replace(/\{server\}/g, member.guild.name)
      .replace(/\{membercount\}/g, String(member.guild.memberCount ?? 0));
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  async function renderText(text, { color, size, bold, font, fontfile }) {
    const escaped = escapeXml(text);
    const weight = bold ? ' font_weight="bold"' : "";
    const markup = `<span foreground="${color}"${weight}>${escaped}</span>`;
    const opts = {
      text: markup,
      font: `${font} ${size}`,
      rgba: true,
    };
    if (fontfile) opts.fontfile = fontfile;
    const buf = await sharp({ text: opts }).png().toBuffer();
    const meta = await sharp(buf).metadata();
    return { buffer: buf, width: meta.width || 0, height: meta.height || 0 };
  }

  function maskSvg(size, shape, color) {
    const fill = color || "white";
    if (shape === "square") {
      const r = Math.round(size * 0.2);
      return `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${fill}"/></svg>`;
    }
    return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${fill}"/></svg>`;
  }

  async function maskAvatar(buf, size, shape) {
    const mask = Buffer.from(maskSvg(size, shape, "white"));
    return sharp(buf)
      .resize(size, size)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  async function generateCard(member, config) {
    try {
      // 1) Fondo (imagen o color)
      let background = null;
      if (config.background_image_url) {
        const res = await fetch(config.background_image_url);
        if (res.ok) {
          background = await sharp(Buffer.from(await res.arrayBuffer()))
            .resize(W, H, { fit: "cover" })
            .png()
            .toBuffer();
        }
      }
      if (!background) {
        background = await sharp({
          create: {
            width: W,
            height: H,
            channels: 3,
            background:
              config.background_color || DEFAULT_CONFIG.background_color,
          },
        })
          .png()
          .toBuffer();
      }

      // 2) Avatar centrado con borde opcional
      let avatarLayer = null;
      let avatarLeft = 0;
      const avatarTop = AVATAR_TOP;
      const border = Math.max(
        0,
        Math.min(12, Number(config.avatar_border_width) || 0),
      );
      try {
        const avatarUrl = member.user.displayAvatarURL({
          extension: "png",
          size: 256,
        });
        const res = await fetch(avatarUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const shape = config.avatar_shape || "circle";
          const avatarMasked = await maskAvatar(buf, AVATAR, shape);
          if (border > 0) {
            const outerSize = AVATAR + border * 2;
            const outer = Buffer.from(
              maskSvg(
                outerSize,
                shape,
                config.avatar_border_color ||
                  DEFAULT_CONFIG.avatar_border_color,
              ),
            );
            const outerPng = await sharp(outer).png().toBuffer();
            avatarLayer = await sharp(outerPng)
              .composite([{ input: avatarMasked, left: border, top: border }])
              .png()
              .toBuffer();
            avatarLeft = Math.round(W / 2 - outerSize / 2);
          } else {
            avatarLayer = avatarMasked;
            avatarLeft = Math.round(W / 2 - AVATAR / 2);
          }
        }
      } catch (e) {
        logger.error("[Welcome] error con el avatar:", e.message);
      }

      // 3) Texto centrado debajo
      const title = replacePlaceholders(config.card_title || "", member).slice(
        0,
        40,
      );
      const subtitle = replacePlaceholders(
        config.card_subtitle || "",
        member,
      ).slice(0, 60);
      const font = config.font_family || "sans-serif";
      const family = resolveFamily(font);

      const align = config.text_align || "center";
      const leftFor = (imgWidth) =>
        align === "right"
          ? W - imgWidth
          : align === "center"
            ? Math.round((W - imgWidth) / 2)
            : 0;
      const titleSize = Math.max(
        16,
        Math.min(100, Number(config.title_font_size) || 46),
      );
      const subtitleSize = Math.max(
        10,
        Math.min(80, Number(config.subtitle_font_size) || 26),
      );
      const titleImg = await renderText(title, {
        color: config.text_color || DEFAULT_CONFIG.text_color,
        size: titleSize,
        bold: true,
        font: family,
        fontfile: font === "Discord" ? FONT_FILE : null,
      });
      const subtitleImg = await renderText(subtitle, {
        color: config.subtitle_color || DEFAULT_CONFIG.subtitle_color,
        size: subtitleSize,
        bold: false,
        font: family,
        fontfile: font === "Discord" ? FONT_FILE : null,
      });

      // Overlay: caja detrás del texto (ancho según el texto)
      const overlayOpacity = Math.max(
        0,
        Math.min(100, Number(config.overlay_opacity) || 0),
      );
      let overlayBox = null;
      let overlayLeft = 0;
      const overlayTop = TITLE_Y - OVERLAY_PAD_Y;
      if (overlayOpacity > 0) {
        const maxW = Math.max(titleImg.width, subtitleImg.width);
        const overlayWidth = maxW + OVERLAY_PAD_X * 2;
        const overlayHeight =
          SUBTITLE_Y + subtitleImg.height - TITLE_Y + OVERLAY_PAD_Y * 2;
        overlayLeft =
          align === "right"
            ? W - overlayWidth
            : align === "center"
              ? Math.round((W - overlayWidth) / 2)
              : 0;
        const ov = hexToRgb(
          config.overlay_color || DEFAULT_CONFIG.overlay_color,
        );
        const rounded = Buffer.from(
          `<svg width="${overlayWidth}" height="${overlayHeight}"><rect x="0" y="0" width="${overlayWidth}" height="${overlayHeight}" rx="${OVERLAY_RADIUS}" ry="${OVERLAY_RADIUS}" fill="white"/></svg>`,
        );
        overlayBox = await sharp({
          create: {
            width: overlayWidth,
            height: overlayHeight,
            channels: 4,
            background: {
              r: ov.r,
              g: ov.g,
              b: ov.b,
              alpha: overlayOpacity / 100,
            },
          },
        })
          .composite([{ input: rounded, blend: "dest-in" }])
          .png()
          .toBuffer();
      }

      // 4) Componer
      const layers = [];
      if (overlayBox) {
        layers.push({
          input: overlayBox,
          left: overlayLeft,
          top: overlayTop,
        });
      }
      layers.push({
        input: titleImg.buffer,
        left: leftFor(titleImg.width),
        top: TITLE_Y,
      });
      layers.push({
        input: subtitleImg.buffer,
        left: leftFor(subtitleImg.width),
        top: SUBTITLE_Y,
      });
      if (avatarLayer) {
        layers.push({ input: avatarLayer, left: avatarLeft, top: avatarTop });
      }
      return await sharp(background).composite(layers).png().toBuffer();
    } catch (e) {
      logger.error("[Welcome] error generando tarjeta:", e.message);
      return null;
    }
  }

  client.on("guildMemberAdd", async (member) => {
    try {
      const config = await loadConfig();
      if (!config.enabled || !config.channel_id) return;

      const channel = await client.channels
        .fetch(config.channel_id)
        .catch(() => null);
      if (!channel || !channel.isTextBased()) return;

      const content = replacePlaceholders(config.message || "", member);
      const card = config.card_enabled
        ? await generateCard(member, config)
        : null;
      if (!content && !card) return;

      const payload = {};
      if (content) payload.content = content;
      if (card) payload.files = [{ attachment: card, name: "welcome.png" }];

      await channel.send(payload).catch(() => {});
    } catch (e) {
      logger.error("[Welcome] error:", e.message);
    }
  });

  return {};
}

module.exports = { createWelcomeSystem };
