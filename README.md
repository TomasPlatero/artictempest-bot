# Discord absence forwarder

Bot sencillo para:
- leer mensajes en un canal público de ausencias
- reenviarlos a un canal privado de oficiales
- borrar el mensaje original

## Setup
1. Instala Node.js 18+.
2. `npm install`
4. Copia `.env.example` a `.env.local`
5. Rellena:
   - `DISCORD_TOKEN`
   - `PUBLIC_ABSENCE_CHANNEL_ID`
   - `OFFICERS_CHANNEL_ID`
6. En Discord Developer Portal activa:
   - **Message Content Intent**
7. Dale al bot permisos en el canal público:
   - Read Messages/View Channel
   - Read Message History
   - Manage Messages
8. Arranca con `npm start`

## Invitar el bot
Usa la URL OAuth2 del portal con estos scopes:
- `bot`

Permisos recomendados:
- View Channel
- Read Message History
- Send Messages
- Embed Links
- Manage Messages

## Comportamiento
- Solo actúa en `PUBLIC_ABSENCE_CHANNEL_ID`
- Reenvía un embed con autor, canal, fecha, texto y adjuntos
- Borra el mensaje original si el reenvío fue exitoso
