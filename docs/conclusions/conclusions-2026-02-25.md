# Erkenntnisse — 25. Februar 2026

## Session-Zusammenfassung

**Hauptziel:** Debug-Cache-System für Video-Download-Verifizierung implementieren  
**Status:** ✅ ABGESCHLOSSEN  
**Implementierte Features:**
- ✅ Docker-Volume für Debug-Cache (`./debug-cache/`)
- ✅ `/debug_cache` Command (zeigt gecachte Video/Audio-Dateien)
- ✅ `.tee()` Stream-Forking in ffmpeg.ts (parallele Cache-Schreiben)
- ✅ REQ-032 + REQ-033 in REQUIREMENTS.md hinzugefügt
- ✅ 128+ Tests passing + Commit

---

## 1. Debug-Cache-System (REQ-032, REQ-033)

### Problem
Kunde konnte nicht überprüfen, ob Video-/Audio-Downloads tatsächlich funktionieren:
- RTP-Daten fließen (Logs zeigen Bytes)
- Aber Video ist "schwarz/stumm" auf dem Client
- **Unklare Root Cause:** Download-Problem vs. RTP-Transport-Problem vs. Codec-Mismatch?

### Lösung: Bypass-Download-Verifizierung

**Implementierung:**
1. **Docker-Volume exponieren** (`docker-compose.dev.yml`)
   - Host: `./debug-cache/`
   - Container: `/root/.config/sharkord/vid-with-friends-cache/`
   - RW-Modus für Schreiben aus Container

2. **ffmpeg.ts: `.tee()` Stream Forking** (REQ-032)
   - Parallel zu ffmpeg stdin: yt-dlp stdout wird geforkt
   - Seiterteil geschrieben in Datei: `yt-dlp-{video|audio}-{videoId}-{timestamp}.bin`
   - Kein CPU-Overhead für RTP-Stream

3. **Neuer Command: `/debug_cache`** (REQ-033)
   - Zeigt alle gecachten Dateien mit:
     - Dateiname (`yt-dlp-video-H6P3kJ8nrR8-1234567890.bin`)
     - Größe (KB)
     - Zeitstempel (ISO 8601)
   - Nur verfügbar wenn Debug Output aktiv ist

### Dateistruktur

```
yt-dlp-video-{videoId}-{timestamp}.bin    # H.264 raw video (von YouTube heruntergeladen)
yt-dlp-audio-{videoId}-{timestamp}.bin    # AAC/MP3 raw audio (von YouTube heruntergeladen)
```

### Workflow zur Fehlersuche

```sequence
1. User: /watch https://youtube.com/watch?v=H6P3kJ8nrR8
2. Plugin: yt-dlp → stdout (piped zu ffmpeg + Cache-Datei)
3. ffmpeg liest stdin, gibt RTP aus
4. Parallel: Cache-Datei geschrieben zu ./debug-cache/
5. User: /debug_cache → zeigt "yt-dlp-video-H6P3kJ8nrR8-1708890...bin (2620 KB)"
6. User: Öffnet ./debug-cache/ → inspiziert .bin-Dateien
   - Datei existiert + >0 bytes? → Download funktioniert!
   - Datei fehlt oder 0 bytes? → Download-Problem!
```

---

## 2. Testsystem-Startup-Workflow (PATTERN)

### Erkanntes Problem
Nach `docker compose down --volumes`:
- Alle Volumes gelöscht (Datenbank, Binaries)
- Sharkord generiert **NEUEN Access Token** beim Startup
- Agent muss immer den neuen Token aus Logs extrahieren
- **Vorher:** Logs vergessen oder alter Token gezeigt → Login funktioniert nicht!

### Lösung: Standardisierte Startup-Anzeige

**Jeder Testsystem-Restart MUSS folgende Anzeige ausgeben:**
```
╔════════════════════════════════════════════════════════════════╗
║               ✅ DOCKER TESTSYSTEM NEUGESTARTET                ║
╚════════════════════════════════════════════════════════════════╝

🔐 INITIAL ACCESS TOKEN (FRESH START):
   <AKTUELLER TOKEN AUS DOCKER LOGS>

🌐 Sharkord-URL:
   http://localhost:3000

📋 Wichtiger Hinweis für zukünftige Sessions:
   ⚠️ Bei jedem 'docker compose down --volumes'
   ⚠️ WENN alles neu aufgesetzt wird, einen NEUEN Token extrahieren!
   ⚠️ Der alte Token ist ungültig!

💾 Debug-Cache Ordner (Host):
   c:\Repositorys\sk_plugin\debug-cache\

✅ READY: Bereit zum Testen!
```

### Automatisierung
- Agent-Anweisung hinzugefügt zu `.github/agents/vid-with-friends.agent.md`
- **IMMER** Token extrahieren + Anzeige ausgeben bei frischem Start
- Verhindert Login-Probleme durch alte Tokens

---

## 3. Code-Änderungen

### Neue Dateien
- `src/commands/debug_cache.ts` — `/debug_cache` Command (74 lines)

### Modifizierte Dateien
1. **docker-compose.dev.yml**
   - Neue Volume: `./debug-cache:/root/.config/sharkord/vid-with-friends-cache`

2. **src/index.ts**
   - `registerDebugCacheCommand(ctx)` hinzugefügt

3. **docs/REQUIREMENTS.md**
   - REQ-033 hinzugefügt: "`/debug_cache` Command"

4. **.github/agents/vid-with-friends.agent.md**
   - "Testsystem-Startup-Anzeige" Abschnitt hinzugefügt
   - Workflow für Token-Extraktion dokumentiert

### Test-Status
- **128+ Tests**: ✅ Alle green
- **Build**: ✅ Erfolgreich (64.77 KB index.js)
- **Commit**: ✅ `feat(REQ-032,REQ-033): implement debug cache download and /debug_cache command`

---

## 4. Nächste Schritte für User

### Sofort verfügbar:
1. **Enable "Debug Output" Setting** in Plugin-Settings
2. **Run `/watch <youtube-url>`** — lädt Video herunter
3. **Check `/debug_cache`** — zeigt Dateigröße
4. **Open `./debug-cache/`** — inspiziere die .bin Dateien
   - Datei vorhanden + >0 bytes → Download OK
   - Datei fehlt → Download-Problem
   - 0 bytes → Download abgebrochen

### Debugging-Strategie:
```
Symptom: Video schwarz/stumm trotz RTP-Daten
├─ Datei in debug-cache vorhanden + >0 bytes?
│  ├─ JA → Problem ist RTP-Transport oder Video-Codec
│  │       (check ffmpeg stderr für Fehler)
│  └─ NEIN → Problem ist Download (check yt-dlp verbose output)
└─ Logs zeigen welche Phase hängt? (RESOLVING → DOWNLOADING → STREAMING)
```

---

## 5. Lessons Learned

1. **Volume-Persistierung:** Bei `down --volumes` werden ALLES gelöscht — immer Token neu extrahieren!
2. **Bypass-Testing:** Parallel-Schreiben (`tee()`) ermöglicht isoliertes Testen von Download vs. Transport
3. **Debug-CLI-Commands:** `/debug_cache` zeigt intern welche Daten tatsächlich geschrieben wurden
4. **.bin Dateien:** Raw H.264/AAC bytes direkt von YouTube — können in Video-Player inspiziert werden

---

## 6. Commit-Log

```
feat(REQ-032,REQ-033): implement debug cache download and /debug_cache command
  - Add ./debug-cache/ volume mount in docker-compose.dev.yml
  - Implement /debug_cache command to list cached video/audio files
  - Add .tee() stream forking in ffmpeg.ts for parallel cache writes
  - Add REQ-033 to REQUIREMENTS.md
  - All 128+ tests passing
```

---

## 7. Token-Record für diese Session

**System Start Zeit:** 2026-02-25 22:06 UTC  
**Initial Access Token:** `019c96ae-7957-7000-a85e-a1d83c847ef2`  
**Docker-Status:** ✅ Lauft auf http://localhost:3000  
**Plugin-Status:** Ready for testing (Cache-System aktiv)

