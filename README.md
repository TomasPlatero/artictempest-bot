# Artic Tempest Discord Bot

Bot de Discord de la hermandad Artic Tempest.

## Comandos personalizados

Los comandos viven en la tabla `commands` de MySQL y se configuran desde el
dashboard (`/dashboard/comandos`). El bot los carga cada minuto y ejecuta la
acción al recibir la interacción de Discord.

### Acción `purge_messages` (borrar mensajes)

Añade esta acción a un comando (p. ej. `/limpiar`) para borrar mensajes del canal
donde se usa:

- El dashboard registra en Discord la opción `cantidad` (1-100, obligatoria);
  el comando pide al usuario cuántos mensajes borrar.
- Respeta los roles permitidos/denegados del comando y exige el permiso
  **Gestionar mensajes** al usuario y al bot.
- Solo borra mensajes de los últimos 14 días (límite del borrado masivo de
  Discord); los fijados y los más antiguos se omiten y el bot indica cuántos.
- Necesita los intents `GuildMessages` + `MessageContent` (ya activados) y el
  permiso `Read Message History` en el canal para poder leer los mensajes.

## Tests

```bash
npm test
```
