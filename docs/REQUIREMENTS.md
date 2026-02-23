# Anforderungskatalog — sharkord-vid-with-friends

Jede Anforderung hat eine eindeutige ID. Tests und Commits MÜSSEN auf ihre zugehörige
Anforderungs-ID verweisen. Einmal gesetzte IDs dürfen nicht mehr angepasst werden!

## Legende

| Priorität | Bedeutung |
|-----------|-----------|
| **Must**  | Pflicht für v0.1.0 |
| **Should**| Angestrebt für v0.1.0, kann geschoben werden |
| **Could** | Nice-to-have, kein Blocker |

## Anforderungen

### Wiedergabe

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-001 | Nutzer kann ein YouTube-Video per URL oder Suchbegriff abspielen (`/watch <url\|query>`) | Must |
| REQ-002 | Video wird als RTP-Stream (Video H264 + Audio Opus) via Mediasoup an alle Channel-Teilnehmer gestreamt | Must |
| REQ-003 | Alle Nutzer im Voice-Channel sehen frame-synchron denselben Stream (Server-Side Streaming) | Must |
| REQ-010 | Wiedergabe kann gestoppt werden (`/watch_stop`) — Stream + Queue werden beendet | Must |
| REQ-011 | Aktuell laufendes Video kann abgefragt werden (`/nowplaying`) | Must |
| REQ-012 | Lautstärke kann angepasst werden (`/volume <0-100>`) — wirkt ab nächstem Video | Should |
| REQ-013 | Stream kann pausiert und fortgesetzt werden (`/pause`) | Should |

### Warteschlange (Queue)

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-004 | Videos können in eine Warteschlange eingereiht werden (automatisch wenn bereits ein Video läuft) | Must |
| REQ-005 | Warteschlange ist pro Voice-Channel isoliert | Must |
| REQ-006 | Warteschlange kann angezeigt werden (`/queue`) | Must |
| REQ-007 | Videos können aus der Warteschlange entfernt werden (`/remove <position>`) | Must |
| REQ-008 | Aktuelles Video kann übersprungen werden (`/skip` → nächstes in Queue) | Must |
| REQ-009 | Nach Ende eines Videos wird automatisch das nächste aus der Queue gestartet (Auto-Advance) | Must |

### Hybrid-Sync

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-014 | Optional: Clientseitiger YouTube-Player mit Server-koordinierter Sync als Qualitäts-Alternative | Should |

### Plugin-Lifecycle & Infrastruktur

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-015 | Plugin kann sauber geladen und entladen werden (`onLoad`/`onUnload`) | Must |
| REQ-016 | Beim Schließen eines Voice-Channels werden Stream und Queue bereinigt | Must |
| REQ-017 | Plugin bietet UI-Komponente zur Anzeige des aktuellen Videos und der Queue | Should |
| REQ-018 | Plugin-Settings: Bitrate (Video/Audio), Standard-Lautstärke, Sync-Modus konfigurierbar | Should |

### Nichtfunktionale Anforderungen

| ID | Anforderung | Priorität |
|----|-------------|----------|
| REQ-019 | Code-Qualität: Kein `any`, kein `var`, keine Default-Exports, strikte TypeScript-Config | Must |
| REQ-020 | Testabdeckung: Jede funktionale Anforderung hat mindestens einen zugehörigen Test | Must |
| REQ-021 | Performance: Plugin-Load darf die Sharkord-Startzeit nicht merklich beeinträchtigen | Should |
| REQ-022 | Sicherheit: Keine Secrets/API-Keys im Code, keine unsanitisierten User-Inputs | Must |
| REQ-023 | Wartbarkeit: Modularer Aufbau mit klarer Trennung (Queue, Stream, Sync, Commands) | Must |
| REQ-024 | Portabilität: Plugin läuft auf Linux, macOS und Windows ohne Code-Anpassungen | Should |
| REQ-025 | Dokumentation: README (Englisch), REQUIREMENTS und ARCHITECTURE sind aktuell | Should |
| REQ-026 | Plugin-Setting "Debug Output" (Boolean) aktiviert/deaktiviert detailliertes Logging für Stream-Prozesse, ffmpeg stderr, yt-dlp Aufrufe, und Fehler-Diagnose | Must |

## Traceability

Jeder Test MUSS mit dem Format `[REQ-xxx]` auf eine oder mehrere Anforderungen
verweisen. Jeder Commit MUSS im Format `feat(REQ-xxx): ...` oder `test(REQ-xxx): ...`
eine Anforderung referenzieren.

**Ausnahme:** Commits vom Typ `docs` benötigen keine REQ-ID (z. B. `docs: update README`).
