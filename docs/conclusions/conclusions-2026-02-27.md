# Erkenntnisse — 27. Februar 2026

## Session-Zusammenfassung

**Hauptziel:** Session gestartet, Projekt-Kontext geladen, TypeScript-Fehler behoben.

**Erreicht:**
- ✅ Vollständiger Projekt-Kontext geladen und analysiert
- ✅ 3 TypeScript Compile-Fehler in Core-Dateien behoben
- ✅ Alle `src/` Dateien kompilieren fehlerfrei

---

## 1. Behobene TypeScript-Fehler

### 1.1 `src/index.ts` — Fehlender Methoden-Name
- **Problem:** `syncController.handleProcessExit(channelId)` — Methode existiert nicht auf `SyncController`
- **Fix:** Umbenannt zu `syncController.onVideoEnded(channelId)` (korrekte Methode)
- **Zeile:** 194

### 1.2 `src/stream/ffmpeg.ts` — Type Mismatch
- **Problem:** `match[1]` ist `string | undefined`, Funktion erwartet `string` Return
- **Fix:** `match?.[1] ?? ""` (safe optional chaining mit nullish coalescing)
- **Zeile:** 173

### 1.3 `src/ui/components.tsx` — JSX Namespace + DOM-Typen
- **Problem 1:** `JSX` Namespace nicht gefunden → fehlender Import
- **Fix:** `import type { JSX } from "react"` hinzugefügt
- **Problem 2:** `e.currentTarget.style` → `style`-Property nicht verfügbar ohne `"dom"` in tsconfig lib
- **Fix:** Cast zu `any` statt `HTMLElement` (tsconfig hat bewusst kein `"dom"`, da Server-Plugin)
- **Begründung:** `"dom"` in `lib` hinzuzufügen würde Konflikte mit Bun-Types verursachen

---

## 2. Projekt-Status (Zusammenfassung)

### Architektur
- **Migration RTP → HLS** abgeschlossen (wegen Sharkord v0.0.7 Consumer-Bug)
- **Pipeline:** yt-dlp → ffmpeg → HLS Segments → Bun.serve() HTTP Server
- **Alle Komponenten implementiert:** Queue, Stream, Sync, Commands, Settings, UI

### Aktueller Blocker
- **ffmpeg Exit Code 139** (Segmentation Fault) — crasht sofort beim Spawn in Docker
- Debug-Logging wurde in letzter Session vorbereitet, aber noch nicht getestet
- **Hypothesen:** Binary Corruption, Architecture Mismatch (x86 vs ARM), Missing Libs, Bun.spawn Bug

### Code-Qualität
- ✅ Alle `src/` Dateien kompilieren fehlerfrei (`tsc --noEmit`)
- ⚠️ Nicht-kritische Fehler in Utility-Dateien (`claim-owner.ts`, `claim-owner.html`) bleiben bestehen

---

## 3. Offene Aufgaben (Priorität 1)

1. **ffmpeg Debug-Test starten:**
   - `/watch https://www.youtube.com/watch?v=dQw4w9WgXcQ`
   - Live-Logs: `docker logs -f sharkord-dev | grep FFmpeg`
   - Ziel: Crash-Ursache identifizieren

2. **Nach Crash-Diagnose:**
   - If "Binary test PASSES" → Problem in Kommando-Args
   - If "Binary test FAILS" → ffmpeg/Libs corrupted → `docker compose down -v && up`
   - If "No output" → Bun.spawn Issue → Alternative Spawn-Methode

3. **Build & Deploy:**
   ```bash
   bun run build && docker compose -f docker-compose.dev.yml restart sharkord-dev
   ```

---

## 4. Dateien geändert diese Session

| Datei | Änderung | Status |
|-------|----------|--------|
| [src/index.ts](../src/index.ts) | `handleProcessExit` → `onVideoEnded` | ✅ Fix |
| [src/stream/ffmpeg.ts](../src/stream/ffmpeg.ts) | Safe optional chaining für regex match | ✅ Fix |
| [src/ui/components.tsx](../src/ui/components.tsx) | JSX Import + `any` Cast für Style-Zugriffe | ✅ Fix |

---

## 5. Referenz-Kommandos

```bash
# Build
bun run build

# TypeScript Check
bun run lint

# Docker deploy
bun run build && docker compose -f docker-compose.dev.yml restart sharkord-dev

# Logs anschauen
docker logs sharkord-dev -f

# Nur FFmpeg Logs
docker logs sharkord-dev -f 2>&1 | grep -E "FFmpeg|HLS"
```
