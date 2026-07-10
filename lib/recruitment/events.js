const REDIS_EVENTS_KEY = 'recruitment:bot:events';

function createEventConsumer(redisClient, handlers) {
  let running = false;

  async function poll() {
    while (running) {
      try {
        const raw = await redisClient.rpop(REDIS_EVENTS_KEY);
        if (raw) {
          let event;
          if (typeof raw === 'string') {
            try {
              event = JSON.parse(raw);
            } catch {
              console.warn(
                '[Recruitment:Events] Skipping malformed entry:',
                raw.slice(0, 80),
              );
              continue;
            }
          } else {
            event = raw;
          }
          const handler = handlers[event.type];
          if (handler) {
            await handler(event);
          } else {
            console.warn(
              '[Recruitment:Events] Unknown event type:',
              event.type,
            );
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('[Recruitment:Events] Poll error:', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    console.log('[Recruitment:Events] Consumer started');
    poll();
  }

  function stop() {
    running = false;
  }

  return { start, stop };
}

module.exports = {
  createEventConsumer,
  REDIS_EVENTS_KEY,
};
