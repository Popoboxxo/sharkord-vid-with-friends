# sharkord-vid-with-friends

Ein Sharkord-Plugin das gemeinsames YouTube-Schauen in Voice-Channels ermöglicht.
Server-seitiges Streaming über yt-dlp → ffmpeg → Mediasoup RTP garantiert
frame-genaue Synchronisation. Optionaler Client-Side YouTube-Player als Hybrid-Modus.
Warteschlange pro Voice-Channel.

## Tech-Stack

- **Sprache:** TypeScript (ES6+, strict — kein `any`, `var`, `require()`)
- **Runtime:** Bun (NICHT Node.js) — `Bun.spawn`, `bun:test`, etc.
- **Streaming:** Mediasoup (WebRTC SFU), ffmpeg, yt-dlp
- **API:** tRPC
- **UI:** React
- **Validierung:** Zod (Input-Validierung für Command-Args, Settings)
- **Plattform:** Sharkord Plugin SDK (`@sharkord/plugin-sdk`, `@sharkord/shared`)

## Architektur

```
src/
├── index.ts              # Plugin-Entry: onLoad, onUnload, components
├── queue/                # Warteschlangen-Logik (rein funktional)
│   ├── queue-manager.ts
│   └── types.ts
├── stream/               # Mediasoup Transport, ffmpeg, yt-dlp
│   ├── stream-manager.ts
│   ├── ffmpeg.ts
│   ├── hls-server.ts
│   └── yt-dlp.ts
├── sync/                 # Orchestrierung: Queue + Stream
│   └── sync-controller.ts
├── commands/             # Slash-Commands (/watch, /queue, /skip, etc.)
├── ui/                   # React UI für Plugin-Slots
│   └── components.tsx
└── utils/
    └── constants.ts
```

## Code-Konventionen

- **Named Exports only** — KEINE Default-Exports
- **Kein `any`** — verwende `unknown` + Type Guards oder Zod
- **Kein `var`** — nur `const` / `let`
- **Kein `require()`** — ES6 imports
- **Kein `node:` Prefix** wenn ein Bun-Äquivalent existiert
- **kebab-case** Dateinamen: `queue-manager.ts`, `sync-controller.ts`
- **Zod** für Input-Validierung (Command-Args, Settings)
- **Fehlerbehandlung:** `new Error("User message")` in Commands, `ctx.log()` für technische Details

## Build & Test

```bash
# Build
bun run build

# Tests
bun test                              # Alle Tests
bun test tests/unit/                  # Unit-Tests
bun test tests/integration/           # Integration-Tests
bun test tests/unit/queue-manager.test.ts  # Einzelne Datei

# Docker Testsystem
docker compose -f docker-compose.dev.yml up
docker compose -f docker-compose.dev.yml down
docker logs sharkord-dev -f

# Rebuild + Reload
bun run build && docker compose -f docker-compose.dev.yml restart sharkord
```

## Requirements & TDD

- Jede Code-Änderung MUSS auf eine `REQ-xxx` in `docs/REQUIREMENTS.md` verweisen
- Tests ZUERST schreiben (TDD: Red → Green → Refactor)
- Jeder Test MUSS `[REQ-xxx]` im Namen tragen
- Aktueller REQ-Bereich: `REQ-001` bis `REQ-040`

## Commit-Konventionen

Format: `<type>(REQ-xxx): <beschreibung>`

| Type | Verwendung | REQ-ID Pflicht? |
|------|----------|----------------|
| `feat` | Neues Feature | Ja |
| `fix` | Bugfix | Ja |
| `test` | Tests hinzufügen/ändern | Ja |
| `refactor` | Refactoring ohne Verhaltensänderung | Ja |
| `chore` | Build, Dependencies, Config | Ja |
| `docs` | Dokumentation | Nein |

## Dokumentation

- `docs/REQUIREMENTS.md` — Source of Truth für alle Anforderungen
- `docs/CODEBASE_OVERVIEW.md` — Codegenaues Funktionsinventar
- `docs/ARCHITECTURE.md` — Architektur-Überblick mit Diagrammen
- `docs/conclusions/` — Tägliche Session-Erkenntnisse
- `README.md` — Projektbeschreibung (**Englisch**)

## Agenten-System

Spezialisierte Sub-Agenten unter `.claude/agents/`:

| Agent | Zuständigkeit |
|-------|--------------|
| `vid-with-friends` | Orchestrator — koordiniert alle Agenten |
| `vwf-requirements` | Requirements Engineering, REQ-IDs, Traceability |
| `vwf-developer` | Code-Implementierung nach REQ-IDs |
| `vwf-tester` | TDD, Test-Suite, Testabdeckung |
| `vwf-validator` | Validierung, DoD-Check, Code-Qualität |
| `vwf-documenter` | CODEBASE_OVERVIEW, ARCHITECTURE, README, Erkenntnisse |
| `vwf-release` | Release-Builds, GitHub Releases, Versionierung |

## Sprache

- **README.md** → Englisch
- **Code-Kommentare, Commit-Messages** → Englisch
- **Alle anderen Dokumente** → Deutsch
- **Kommunikation mit dem Nutzer** → Deutsch
