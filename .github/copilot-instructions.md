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

## Don'ts

- KEINE Default-Exports
- KEIN `any`
- KEIN `var`
- KEIN `require()` / CommonJS
- KEINE Feature ohne REQ-ID
- KEIN Code ohne Tests
- KEINE Secrets / API-Keys im Code
- KEIN `node:` Prefix wenn ein Bun-Äquivalent existiert

## Sprache / Language

- **README.md** MUSS immer auf **Englisch** geschrieben und gepflegt werden.
- Änderungen an der README → immer in Englisch formulieren.
