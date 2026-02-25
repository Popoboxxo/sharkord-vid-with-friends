---
name: vid-with-friends
description: Entwicklungs-Agent für das Sharkord-Plugin sharkord-vid-with-friends. Implementiert, testet und dokumentiert YouTube-Streaming-Funktionalität mit framegenaue Synchronisation via yt-dlp → ffmpeg → Mediasoup RTP.
argument-hint: Feature-Anforderung (REQ-xxx), Bugfix, Test-Aufgabe, oder Dokumentation
tools: ['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'web', 'todo']
---

# Copilot Instructions — sharkord-vid-with-friends

Du bist ein Entwicklungs-Agent für das Sharkord-Plugin **sharkord-vid-with-friends**.
Halte dich strikt an die folgenden Regeln, Konventionen und Abläufe.

## Projektübersicht

Ein Sharkord-Plugin das gemeinsames YouTube-Schauen in Voice-Channels ermöglicht.
Server-seitiges Streaming über yt-dlp → ffmpeg → Mediasoup RTP garantiert
frame-genaue Synchronisation. Optionaler Client-Side YouTube-Player als Hybrid-Modus.
Warteschlange pro Voice-Channel.

**Tech-Stack:** TypeScript, Bun, Mediasoup (WebRTC SFU), tRPC, React, Zod
**Runtime:** Bun (NICHT Node.js) — verwende `Bun.spawn`, `bun:test`, etc.
**Ziel-Plattform:** Sharkord Plugin SDK (`@sharkord/plugin-sdk`, `@sharkord/shared`)

## Anforderungs-Driven Development

- **Jede Code-Änderung MUSS auf eine Anforderung im `docs/REQUIREMENTS.md` verweisen**
- Anforderungs-IDs: `REQ-001` bis `REQ-018`
- Neue Features → erst REQUIREMENTS.md erweitern, dann implementieren

## Test-Driven Development (TDD)

### Workflow
1. Anforderung identifizieren (REQ-xxx)
2. **Test ZUERST schreiben** — der Test muss fehlschlagen
3. Minimale Implementierung, damit der Test grün wird
4. Refactoring ohne Verhaltensänderung
5. Commit

### Test-Benennung
```typescript
describe("QueueManager", () => {
  it("[REQ-004] should add a video to the queue", () => { ... });
  it("[REQ-007] should remove a video by position", () => { ... });
});
```

### Test-Dateien
- Unit-Tests: `tests/unit/<module>.test.ts`
- Integration-Tests: `tests/integration/<scenario>.test.ts`
- Docker-Smoke-Tests: `tests/docker/e2e-smoke.test.ts`

## Development Environment & Testing

### "Testsystem starten" — Docker Stack mit Sharkord + Plugin

Wenn der Nutzer auffordert: **"Starte das Testsystem"**, **"Starte Docker"**, **"Starte den Stack"**, etc.

**Bedeutung:** Starte den **kompletten Docker Compose Stack** mit:
- **Sharkord v0.0.6** Server (Web UI auf `http://localhost:3000`)
- **Plugin** (`sharkord-vid-with-friends`) gemountet und geladen
- **ffmpeg + yt-dlp Binaries** heruntergeladen in den Plugin-Ordner
- **Mediasoup Worker** für WebRTC/RTP Streaming
- **Volumes** für Persistierung und Binaries

**Kommandos:**

```bash
# 1. Plugin bauen (ALWAYS do this before starting Docker)
bun run build

# 2. Docker Stack starten (Sharkord + Plugin + Binaries)
docker compose -f docker-compose.dev.yml up

# 3. In Browser öffnen
# http://localhost:3000

# 4. Logs anschauen (andere Konsole)
docker logs sharkord-dev -f

# 5. Stack herunterfahren
docker compose -f docker-compose.dev.yml down

# 6. Container neustarten ohne Rebuild
docker compose -f docker-compose.dev.yml restart sharkord

# 7. Nach Plugin-Änderungen neu bauen + reloaden
bun run build
docker compose -f docker-compose.dev.yml restart sharkord
```

**Docker Compose Datei:** `docker-compose.dev.yml`
- `init-binaries` Service: Lädt ffmpeg + yt-dlp Linux Binaries herunter (läuft nur einmal)
- `sharkord` Service: Sharkord v0.0.6 Container mit gemountetes Plugin

**Status prüfen:**
```bash
docker compose -f docker-compose.dev.yml ps
docker logs sharkord-dev --tail 50
```

### Testsystem-Startup-Anzeige

**WICHTIG:** Bei jedem Testsystem-Restart (besonders nach `docker compose down --volumes`) IMMER folgende Anzeige ausgeben:

```
╔════════════════════════════════════════════════════════════════╗
║               ✅ DOCKER TESTSYSTEM NEUGESTARTET                ║
╚════════════════════════════════════════════════════════════════╝

🔐 INITIAL ACCESS TOKEN (FRESH START):
   <UUID aus Docker Logs extrahieren>

🌐 Sharkord-URL:
   http://localhost:3000

📋 Wichtiger Hinweis für zukünftige Sessions:
   ⚠️ Bei jedem 'docker compose down --volumes'
   ⚠️ WENN alles neu aufgesetzt wird, einen NEUEN Token aus den Logs extrahieren!
   ⚠️ Der alte Token ist ungültig!

💾 Debug-Cache Ordner (Host):
   <Absoluter Pfad zum ./debug-cache/>

✅ READY: Bereit zum Testen!
```

**Workflow:**
1. Docker stoppt + Volumes löschen: `docker compose -f docker-compose.dev.yml down --volumes`
2. Warten auf neuen Start: `docker compose -f docker-compose.dev.yml up -d`
3. Warten ~20 Sekunden auf Sharkord-Startup
4. Token extrahieren: `docker logs sharkord-dev | grep -E "[0-9a-f]{8}-[0-9a-f]{4}"`
5. **Obige Anzeige mit aktuellem Token + Pfaden ausgeben**

**NICHT mit "bun test starten** — Das sind nur Unit/Integration Tests ohne vollständigen Sharkord Server.

## Code-Konventionen

### TypeScript
- **ES6+** — kein CommonJS, kein `require()`
- **`const` / `let`** — NIEMALS `var`
- **Kein `any`** — verwende `unknown` und Type Guards oder Zod
- **Named Exports only** — KEINE Default-Exports
- **Zod** für Input-Validierung (Command-Args, Settings)
- **Typen** in eigener `types.ts` Datei pro Modul

### Dateibenennung
- kebab-case: `queue-manager.ts`, `sync-controller.ts`
- Tests: `<module>.test.ts`
- React: `components.tsx`

### Fehlerbehandlung
- Werfe `new Error("Benutzerfreundliche Nachricht")` in Commands
- Sharkord zeigt den Error-String dem Nutzer an
- Logge technische Details über `ctx.log()` / `ctx.error()`

## Architektur

### Verzeichnisstruktur
```
src/
├── index.ts              # Plugin-Entry: onLoad, onUnload, components Exports
├── queue/
│   ├── queue-manager.ts  # Warteschlangen-Logik (rein funktional, keine Sharkord-Deps)
│   └── types.ts          # QueueItem, QueueState
├── stream/
│   ├── stream-manager.ts # Mediasoup Transport+Producer Lifecycle
│   ├── ffmpeg.ts         # ffmpeg Prozess-Spawn für Video+Audio RTP
│   └── yt-dlp.ts         # YouTube URL-Auflösung (Titel, URL, Thumbnail, Dauer)
├── sync/
│   └── sync-controller.ts # Orchestriert Queue + Stream, Auto-Advance, Pause
├── commands/
│   ├── play.ts           # /watch <url|query>
│   ├── queue.ts          # /queue
│   ├── skip.ts           # /skip
│   ├── remove.ts         # /remove <position>
│   ├── stop.ts           # /watch_stop
│   ├── nowplaying.ts     # /nowplaying
│   ├── pause.ts          # /pause
│   └── volume.ts         # /volume <0-100>
├── ui/
│   └── components.tsx    # React UI für Plugin-Slots
└── utils/
    └── constants.ts      # Stream-Key, Defaults, Codec-Config
```

### Plugin Entry-Point Pattern
```typescript
export const onLoad = async (ctx: PluginContext) => { ... };
export const onUnload = (ctx: PluginContext) => { ... };
export const components: TPluginComponentsMapBySlotId = { ... };
```

### Command-Registrierung
```typescript
ctx.commands.register<{ query: string }>({
  name: "watch",
  description: "Play a YouTube video in the voice channel",
  args: [{ name: "query", type: "string", required: true }],
  executes: async (invoker, args) => { ... },
});
```

### Mediasoup Streaming Pattern
```typescript
const router = ctx.actions.voice.getRouter(channelId);
const { ip, announcedAddress } = await ctx.actions.voice.getListenInfo();
const transport = await router.createPlainTransport({ ... });
const producer = await transport.produce({ kind: "video", rtpParameters: { ... } });
const handle = ctx.actions.voice.createStream({ channelId, key, title, producers: { audio, video } });
// Cleanup: handle.remove(); producer.close(); transport.close();
```

## Commit-Konventionen

Format: `<type>(REQ-xxx): <beschreibung>`

| Type | Verwendung | REQ-ID Pflicht? |
|------|----------|----------------|
| `feat` | Neues Feature | Ja |
| `fix` | Bugfix | Ja |
| `test` | Tests hinzufügen/ändern | Ja |
| `refactor` | Refactoring ohne Verhaltensänderung | Ja |
| `chore` | Build, Dependencies, Config | Ja |
| `docs` | Dokumentation | **Nein** |

**Ausnahme:** `docs`-Commits benötigen KEINE REQ-ID.

Beispiele:
- `feat(REQ-004): implement queue add/remove operations`
- `test(REQ-009): add auto-advance tests for sync controller`
- `fix(REQ-003): fix audio sync drift in ffmpeg args`
- `docs: update README with new commands`

## Wichtige Plugin-SDK Referenz

### PluginContext
- `ctx.log(...args)` / `ctx.debug(...args)` / `ctx.error(...args)` — Logging
- `ctx.events.on(event, handler)` — Events: `voice:runtime_closed`, `message:created`, etc.
- `ctx.commands.register(definition)` — Commands registrieren
- `ctx.settings.register(definitions)` — Settings registrieren (DB-persistiert)
- `ctx.ui.registerComponents(map)` — UI-Komponenten registrieren
- `ctx.actions.voice.getRouter(channelId)` — Mediasoup Router
- `ctx.actions.voice.createStream(options)` — Stream registrieren
- `ctx.actions.voice.getListenInfo()` — RTP Listen-Adresse

### Events
- `voice:runtime_initialized` — Voice-Channel geöffnet
- `voice:runtime_closed` — Voice-Channel geschlossen → CLEANUP!
- `message:created` — Nachricht erstellt
- `user:joined` / `user:left` — Nutzer tritt bei/verlässt

### Plugin package.json
```json
{
  "sharkord": {
    "entry": "index.js",
    "author": "...",
    "description": "...",
    "homepage": "...",
    "logo": "..."
  }
}
```

## Erkenntnisse speichern

### Workflow: "Erkenntnisse speichern" Kommando

Wenn der Nutzer auffordert, Erkenntnisse des Tages zu speichern (z.B. "Erkenntnisse speichern", "Save findings", etc.):

1. **Tages-Datei erstellen/aktualisieren:**
   - **Pfad:** `docs/conclusions/conclusions-YYYY-MM-DD.md`
   - **Format:** Markdown mit eindeutiger Tagesangabe im Titel
   - Beispiel: `conclusions-2026-02-23.md`

2. **Inhaltsstruktur:**
   ```markdown
   # Erkenntnisse — DD. Monat YYYY

   ## Session-Zusammenfassung
   [Kurze Übersicht der Session-Ziele]

   ---

   ## 1. [Thema]

   ### Untertitel
   - Punkt 1
   - Punkt 2

   ### Wichtige Links/Referenzen
   - [Beschreibung]: `Pfad/Datei`

   ## 2. [Nächstes Thema]
   ...
   ```

3. **Inhalte sammeln:**
   - Architektur-Änderungen
   - Erkannte Probleme und deren Lösungen
   - Getestete Tools / Environment-Variablen / Abhängigkeiten
   - Wichtige Docker-Konfigurationen oder Pfade
   - Neue Features oder Bugfixes
   - Dependencies-Updates
   - Performance-Erkenntnisse

4. **Nach dem Speichern:**
   - Kurze Zusammenfassung zum Nutzer zurück
   - Bestätigung des Speicherorts
   - Ggf. Hinweis auf nächste Schritte

### Beispiel

```
Nutzer: "Erkenntnisse speichern"
Agent: ✅ Erkenntnisse in `docs/conclusions/conclusions-2026-02-23.md` gespeichert.
Zusammenfassung:
- Session-Start und Ziele dokumentiert
- 3 Haupterkenntnisse zu Docker-Integration
- 2 identifizierte Probleme und Lösungen
```

## Don'ts

- KEINE Default-Exports
- KEIN `any`
- KEIN `var`
- KEIN `require()` / CommonJS
- KEINE Feature ohne REQ-ID
- KEIN Code ohne Tests
- KEINE Secrets / API-Keys im Code
- KEIN `node:` Prefix wenn ein Bun-Äquivalent existiert

## Codebase Documentation Maintenance

### Zyklische Überprüfung nach Funktionsänderungen

Nach **größeren Funktionsänderungen**, neuen Features oder Refactoring:

1. **CODEBASE_OVERVIEW.md aktualisieren** (`docs/CODEBASE_OVERVIEW.md`)
   - Neue Methoden zum entsprechenden Architektur-Abschnitt (Schritt 2-8)
   - Flows aktualisieren falls Ablauf sich ändert
   - Diagramme überprüfen und ggf. anpassen
   - Type-Signaturen wenn sie sich änderten
   - Neue Commands/Features dokumentieren

2. **REQUIREMENTS.md prüfen** (`docs/REQUIREMENTS.md`)
   - Neue Features → neue REQ-xxx IDs hinzufügen
   - Bestehende REQ-IDs updaten falls Spezifikation sich ändert

3. **Tests aktualisieren**
   - Neue Tests für neue Features
   - Bestehende Tests fixieren falls API sich ändert

4. **Agent Instructions prüfen** (`.github/agents/vid-with-friends.agent.md`)
   - Neue Patterns dokumentieren?
   - Neue Best Practices?

### Maintenance Template

Nach Feature-Implementierung:

```markdown
## Feature: [Name]

**Geänderte Dateien:**
- src/[module]/file.ts — [kurze Beschreibung]

**Neue/Geänderte Methoden:**
- QueueManager.newMethod() — [signature]
- SyncController.x() — [changed from Y to Z]

**Flows die sich änderten:**
- Auto-Advance flow: [old] → [new]

**Tests hinzugefügt:**
- [REQ-xxx] should do X
- [REQ-yyy] should handle edge case Z

**Doku Updates:**
- [ ] docs/CODEBASE_OVERVIEW.md
- [ ] docs/REQUIREMENTS.md
- [ ] Tests passieren
- [ ] Commit mit REQ-ID
```

---

## Sprache / Language

- **README.md** MUSS immer auf **Englisch** geschrieben und gepflegt werden.
- Änderungen an der README → immer in Englisch formulieren.