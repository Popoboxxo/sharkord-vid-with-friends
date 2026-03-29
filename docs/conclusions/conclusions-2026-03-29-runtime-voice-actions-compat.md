# Conclusions — 2026-03-29 — Runtime Fix: Voice-Actions API-Kompatibilität (Sharkord 0.0.16)

## Kontext

Beim manuellen `vid-watch`-Start trat nach erfolgreichem Resolve ein Runtime-Abbruch auf:

- `undefined is not an object (evaluating '$.actions.voice.getRouter')`

Das zeigt, dass die Laufzeitumgebung zwar Voice-Actions bereitstellt, aber nicht zwingend unter `ctx.actions.voice.*`.

---

## Ursache

`startStream(...)` in `src/index.ts` griff starr auf die alte Form zu:

- `ctx.actions.voice.getRouter(...)`
- `ctx.actions.voice.getListenInfo()`
- `ctx.actions.voice.createStream(...)`

In Sharkord 0.0.16 kann die API je nach Runtime-Shape auch flach unter `ctx.actions.*` (oder mit kompatiblen Alias-Namen) verfügbar sein.

---

## Umsetzung

Datei: `src/index.ts`

- Neue Resolver-Funktion `resolveVoiceActions(ctx)` eingeführt.
- Unterstützte Formen:
  - `ctx.actions.voice.*`
  - `ctx.actions.*`
  - optional `ctx.voice.*` als zusätzlicher Fallback
- Unterstützte Methoden-Aliasse:
  - Router: `getRouter`, `getVoiceRouter`, `getMediasoupRouter`
  - ListenInfo: `getListenInfo`, `getWebRtcListenInfo`, `getRtpListenInfo`
  - Stream-Erzeugung: `createStream`, `addExternalStream`
- Fehlerdiagnose verbessert:
  - Bei fehlender API wird eine präzise Fehlermeldung mit verfügbaren `actions`/`actions.voice` Keys geworfen.
- `startStream(...)` nutzt jetzt den Resolver statt direkter `ctx.actions.voice.*`-Aufrufe.

Traceability:

- REQ-052 (neu)

---

## Verifikation

1. Build erfolgreich:
   - `bun run build`
2. Relevante Integrations-Regressionstests grün:
   - `bun test tests/integration/index-onload.test.ts tests/integration/plugin-lifecycle.test.ts`
   - Ergebnis: `20 pass, 0 fail`
3. Docker-Deploy erfolgreich:
   - `docker compose -f docker-compose.dev.yml up -d --force-recreate`
4. Plugin startet sauber mit neuer Version:
   - `sharkord-vid-with-friends@v0.1.0-alpha.10-290326-21-01-42`

---

## Erwarteter Effekt

Der vorherige Crash bei `$.actions.voice.getRouter` tritt nicht mehr auf, sofern eine kompatible Voice-Action-Signatur in der Runtime vorhanden ist.
Bei erneuter Fehlersituation liefert der Resolver eine deutlich aussagekräftigere Diagnose.
