function createEventConsumer(supabaseClient, handlers) {
  let running = false;

  async function poll() {
    while (running) {
      try {
        const events = await supabaseClient.query('recruitment_bot_events', {
          select: '*',
          filters: [{ column: 'processed', value: 'is.false' }],
          order: { column: 'created_at', direction: 'asc' },
          limit: 10,
        });

        if (events && events.length > 0) {
          for (const row of events) {
            const event = row.payload;
            const handler = handlers[event.type];
            if (handler) {
              try {
                await handler(event);
              } catch (handlerError) {
                console.error(
                  '[Recruitment:Events] Handler error for',
                  event.type,
                  ':',
                  handlerError.message,
                );
              }
            } else {
              console.warn(
                '[Recruitment:Events] Unknown event type:',
                event.type,
              );
            }

            try {
              await supabaseClient.update('recruitment_bot_events', row.id, {
                processed: true,
              });
            } catch (updateError) {
              console.error(
                '[Recruitment:Events] Failed to mark event processed:',
                updateError.message,
              );
            }
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      } catch (error) {
        console.error('[Recruitment:Events] Poll error:', error.message);
        await new Promise((resolve) => setTimeout(resolve, 10000));
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
};
