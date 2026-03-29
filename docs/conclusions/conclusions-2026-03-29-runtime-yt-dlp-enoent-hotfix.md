# Conclusions — 2026-03-29 — Runtime Hotfix: yt-dlp ENOENT im Docker-Betrieb

## Kontext

Im laufenden Sharkord-Container trat bei `vid-watch` weiterhin ein Runtime-Fehler auf:

- `Failed to resolve video: {"code":"ENOENT","path":"yt-dlp","errno":-2}`

Die Binärdatei war zwar im Container vorhanden, der Prozess fiel jedoch auf einen nicht auflösbaren `yt-dlp`-PATH-Call zurück.

Zusätzlich blockierte ein fremder Container (`hero-introducer-dev`) regelmäßig den UDP-Portbereich `40000-40100`, wodurch `sharkord-dev` instabil startete oder mit Exit 137 beendet wurde.

---

## Änderungen

Datei: `docker-compose.dev.yml`

Im Service `sharkord` wurden explizite Runtime-Variablen ergänzt:

- `SHARKORD_DATA_PATH=/home/bun/.config/sharkord`
- `YT_DLP_PATH=/home/bun/.config/sharkord/plugins/sharkord-vid-with-friends/bin/yt-dlp`
- `FFMPEG_PATH=/home/bun/.config/sharkord/plugins/sharkord-vid-with-friends/bin/ffmpeg`

Damit wird die Binärauflösung deterministisch und unabhängig vom Container-PATH.

---

## Betriebsmaßnahmen

1. Konfliktcontainer vollständig entfernt:
   - `docker rm -f hero-introducer-dev`
2. Plugin neu gebaut:
   - `bun run build`
3. Stack neu erstellt:
   - `docker compose -f docker-compose.dev.yml up -d --force-recreate`

---

## Verifikation

- `docker inspect sharkord-dev --format "{{range .Config.Env}}{{println .}}{{end}}"` zeigt die neuen Env-Variablen aktiv.
- Direkter Binary-Check im laufenden Container erfolgreich:
  - `/home/bun/.config/sharkord/plugins/sharkord-vid-with-friends/bin/yt-dlp --version` -> `2026.03.17`
- Sharkord + Plugin laden sauber (Log: `Loaded successfully.`).

Hinweis: Für den finalen End-to-End-Nachweis des ursprünglichen User-Flows ist ein erneuter manueller `vid-watch`-Aufruf im UI erforderlich.
