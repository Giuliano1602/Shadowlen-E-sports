# RocketLeague Shop Bot

A Discord bot that posts Rocket League shop updates and provides slash commands.

## Features

- `/ping` basic health check
- `/setchannel` define the target channel for scheduled shop posts
- `/shop` fetch and display the current shop data
- Daily shop posting with cron scheduler

## Setup

1. Install dependencies:
   npm install
2. Fill out `.env` values:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - Optional: `SHOP_API_URL`, `SHOP_CRON`
3. Register slash commands:
   npm run deploy-commands
4. Start bot:
   npm start

## 24/7 Runtime (PM2)

Der Bot laeuft jetzt ueber PM2 mit Auto-Restart bei Absturz.

Wichtige Befehle:

- Starten: `npm run pm2:start`
- Neustarten: `npm run pm2:restart`
- Stoppen: `npm run pm2:stop`
- Logs ansehen: `npm run pm2:logs`
- Prozessliste speichern (fuer Wiederherstellung): `npm run pm2:save`

Windows-Autostart wurde eingerichtet, damit PM2 beim Login startet.

## 24/7 Hosting (Render)

Wenn dein PC aus ist, bleibt der Bot nur mit externem Hosting online.

Dieses Repo ist jetzt fuer Render vorbereitet:

- [Dockerfile](Dockerfile)
- [render.yaml](render.yaml)

Schnellstart:

1. Code nach GitHub pushen.
2. Bei Render ein neues Blueprint-Deploy mit diesem Repo erstellen.
3. In Render die Env-Variablen setzen:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - optional: `SHOP_API_URL`, `SHOP_CRON`, `ALERT_CHANNEL_ID`, `HEALTH_HEARTBEAT_MINUTES`
4. Nach dem ersten erfolgreichen Deploy einmal Commands registrieren:
   - Render Shell oeffnen und `npm run deploy:commands` ausfuehren

Hinweise:

- Der Service ist als Worker konfiguriert (kein Web-Port notwendig).
- `/tracking` nutzt Playwright im Headless-Modus (cloud-friendly).

## Health Monitor Alerts

Der Bot sendet jetzt automatisch Health-Alerts in einen Discord-Kanal.

Kanal-Auswahl (in dieser Reihenfolge):

1. `ALERT_CHANNEL_ID`
2. `SHOP_CHANNEL_ID`
3. `data/config.json` `channelId`
4. Fallback-Channel aus dem Code

Optionale Umgebungsvariablen:

- `HEALTH_NOTIFY_STARTUP=true|false` (default: `true`)
- `HEALTH_HEARTBEAT_MINUTES=60` (default: aus, wenn nicht gesetzt)

Beispiele:

- Nur Fehler-Alerts bei Problemen: nichts weiter setzen
- Stundlicher Heartbeat: `HEALTH_HEARTBEAT_MINUTES=60`

## Notes

- `SHOP_API_URL` should return JSON like:

```json
{
   "featured_items": [
      { "name": "Electrolic", "rarity": "Exotic", "type": "Rocket Boost", "price": 600, "image": "https://example.com/image.png" }
   ],
   "daily_items": [
      { "name": "ARA-51", "rarity": "Exotic", "type": "Wheels", "price": 900, "image": "https://example.com/image.png" }
  ]
}
```

- If no API is configured or request fails, the bot now returns no fake demo items.
