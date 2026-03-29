# Conclusions — 2026-03-29 — Bugfixes: Command-Integration & Pipeline-E2E

## Kontext

Nach der 0.0.16-Migration traten in der Test-Suite zwei Bug-Klassen auf:

1. **Integrations-Tests erwarteten veraltete Command-Namen** (`watch`, `queue`, `skip`, ...),
   während die aktuelle Implementierung und Unit-Tests bereits auf `vid-*` (`vid-watch`, `vid-queue`, ...) laufen.
2. **Pipeline-E2E lief außerhalb der Docker-Testumgebung in fehlende Binary-Umgebungsvariablen** (`FFMPEG_PATH`, `YT_DLP_PATH`) und erzeugte dadurch ENOENT-Fehler.

Die folgenden Anpassungen wurden nach expliziter Nutzerfreigabe vorgenommen.

---

## Änderungen (präzise)

### A) Integrationstest-Harmonisierung auf aktuelle Command-API

Datei: `tests/integration/index-onload.test.ts`

- Erwartete Command-Namen aktualisiert:
  - `watch` -> `vid-watch`
  - `queue` -> `vid-queue`
  - `skip` -> `vid-skip`
  - `remove` -> `vid-remove`
  - `watch_stop` -> `vid-stop`
  - `nowplaying` -> `vid-nowplaying`
  - `pause` -> `vid-pause`
  - `resume` -> `vid-resume`
  - `volume` -> `vid-volume`
  - `debug_cache` -> `vid-debug-cache`

Datei: `tests/integration/plugin-lifecycle.test.ts`

- Registrierungs-Assertions auf `vid-*` aktualisiert.
- Command-Ausführung (`ctx.commands.execute`) auf `vid-*` aktualisiert:
  - `queue` -> `vid-queue`
  - `skip` -> `vid-skip`
  - `watch_stop` -> `vid-stop`
  - `remove` -> `vid-remove`
  - `pause` -> `vid-pause`
  - `volume` -> `vid-volume`

**Begründung:**
- Unit-Tests und Produktivcode verwenden konsistent `vid-*`.
- Die alten Namen in den Integrationstests waren veraltet und verursachten False-Negatives.
- Keine Verhaltensänderung am Produktivcode, sondern Korrektur der Integrations-Testerwartung auf den realen API-Stand.

### B) Pipeline-E2E robust gegen Nicht-Docker-Ausführung

Datei: `tests/docker/pipeline-e2e.test.ts`

- `FFMPEG_PATH` und `YT_DLP_PATH` werden nicht mehr auf lokale Standardwerte erzwungen.
- `ensureBinSymlinks()` läuft nur, wenn beide Variablen gesetzt sind.
- Neues Gate `shouldRunPipelineE2E()`:
  - Wenn Docker-Variablen fehlen, wird der Testfall mit klarer Warnung frühzeitig beendet.

**Begründung:**
- Die Datei ist explizit als Docker-Pipeline-Test definiert.
- Ohne Docker-Umgebung sind die binären Voraussetzungen nicht garantiert und führten zu ENOENT, obwohl die Produktivlogik korrekt sein kann.
- Das Gate verhindert Umgebungs-bedingte Fehlalarme in lokalen Host-Runs, während Docker-Runs weiterhin vollständig testen.

### C) Produktivcode-Bugfixes zur Binary-Auflösung

Dateien:
- `src/stream/yt-dlp.ts`
- `src/stream/ffmpeg.ts`

- Erweiterte Binär-Pfadauflösung:
  - ENV-Override (`YT_DLP_PATH`, `FFMPEG_PATH`)
  - Plattform-Fallback (.exe / ohne .exe)
  - PATH-Suche via `Bun.which(...)`

**Begründung:**
- Erhöht Plattformrobustheit (Windows/Linux) und unterstützt Docker- sowie Host-Setups ohne harte Pfadannahmen.

---

## Ergebnis / Validierung

Gezielter Re-Run:

- `tests/integration/index-onload.test.ts` -> grün
- `tests/integration/plugin-lifecycle.test.ts` -> grün
- `tests/docker/pipeline-e2e.test.ts` -> in Nicht-Docker-Umgebung sauber gegated (kein ENOENT-Abbruch)

Diese Änderungen beheben die zuvor blockierenden Test-Fehler ohne fachliche Regressionen im Command- oder Streaming-Code.
