// Lógica de la acción "purge_messages": el comando pide la opción numérica
// `cantidad` y borra ese número de mensajes del canal, empezando por el más
// reciente. Discord solo permite el borrado masivo de mensajes de los últimos
// 14 días, así que los mensajes más antiguos y los fijados se omiten.

/** Nombre de la opción de Discord que pide cuántos mensajes borrar. */
const PURGE_OPTION_NAME = "cantidad";
/** Discord permite borrar como máximo 100 mensajes por llamada. */
const PURGE_MAX_AMOUNT = 100;
/** Discord no permite borrado masivo de mensajes con más de 14 días. */
const MAX_BULK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Normaliza la cantidad pedida: entero entre 1 y `max`, o null si no es válida. */
function clampAmount(raw, max = PURGE_MAX_AMOUNT) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, max);
}

/** Separa los mensajes en borrables, demasiado antiguos y fijados. */
function createPurgePlan(messages, now = Date.now()) {
  const deletable = [];
  const tooOld = [];
  const pinned = [];
  for (const message of messages) {
    if (message.pinned) {
      pinned.push(message);
      continue;
    }
    const createdAt =
      typeof message.createdTimestamp === "number"
        ? message.createdTimestamp
        : now;
    if (now - createdAt >= MAX_BULK_AGE_MS) {
      tooOld.push(message);
      continue;
    }
    deletable.push(message);
  }
  return { deletable, tooOld, pinned };
}

module.exports = {
  PURGE_OPTION_NAME,
  PURGE_MAX_AMOUNT,
  MAX_BULK_AGE_MS,
  clampAmount,
  createPurgePlan,
};
