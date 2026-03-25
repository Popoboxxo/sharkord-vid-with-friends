# Erkenntnisse — 25. März 2026

## Session-Zusammenfassung

Debugging und Fix des SABR-Streaming-Bugs: Auf dem Live-Server kord.awaysome.de wurde kein Video
abgespielt. Ursache war eine Kombination aus YouTube SABR-Enforcement, nicht-portablen HLS-Sub-Format-IDs
und einem zu engen Fallback-Selektor. Fix implementiert als REQ-042 auf Branch `fix/sabr-format-fallback`.

---

## 1. Root Cause Analyse

### Hauptproblem: YouTube SABR-Streaming

YouTube erzwingt für bestimmte Server-IPs und Accounts "Server-Adaptive Bitrate (SABR)"-Streaming.
SABR-Formate erscheinen in `yt-dlp --dump-json` als valide Formate mit `url`-Feld, sind aber beim
tatsächlichen Download nicht verfügbar.

- **Fehlermeldung im Log:** `Requested format is not available. Use --list-formats`
- **Betroffen:** Alle `avc1` (H.264) Formate auf dem Live-Server kord.awaysome.de
- **Hinweis im Log:** `Some web_safari client https formats have been skipped as they are missing a URL. YouTube is forcing SABR streaming`
- **Referenz:** https://github.com/yt-dlp/yt-dlp/issues/12482

Das Problem tritt nur auf dem Live-Server auf, nicht lokal, weil YouTube die Server-IP als
"server-like" einstuft und SABR erzwingt. Das lokale Docker-System hat eine andere IP und erhält
andere (non-SABR) Formate.

### Problem 2: HLS Sub-Format-IDs sind nicht portabel

`resolveVideo` wählt Format-IDs mit `-N` Suffix (z.B. `301-0`). Diese IDs sind HLS-Playlist-Einträge,
die spezifisch für die Server-Session beim `--dump-json` Call sind. Beim späteren Download mit
`-f 301-0` ist das Format nicht mehr verfügbar — besonders wenn zwischen `resolveVideo` und
Download Zeit vergeht oder die Server-IP wechselt.

### Problem 3: Zu enger Fallback-Selektor

Der bisherige Fallback `bv[vcodec^=avc1]` schlägt ebenfalls fehl, wenn der Server SABR für alle
avc1-Formate erzwingt. Es gab keinen vp9/av01 Fallback. Da ffmpeg bereits mit `-c:v libx264`
konfiguriert ist, kann es vp9/av01 zu H.264 re-encodieren — der fehlende Fallback war unnötig
restriktiv.

### Problem 4: Kein JS-Runtime verfügbar

Im Log: `JS Challenge Providers: bun (unavailable), deno (unavailable), node (unavailable), quickjs (unavailable)`

Das schränkt die Format-Verfügbarkeit ein. Die vorhandene cookies.txt gibt bereits
Authenticated-Access (YouTube Account-Cookies), verhindert aber nicht SABR-Enforcement.

---

## 2. Warum lokal funktionsfähig, auf Live-Server nicht?

| Aspekt | Lokal (Docker) | Live-Server kord.awaysome.de |
|--------|---------------|------------------------------|
| IP-Klassifikation | Private/Consumer-IP | Server-IP → YouTube klassifiziert als potenzielle Bot-Infrastruktur |
| SABR-Enforcement | Nein | Ja — alle avc1-Formate per SABR gesperrt |
| Format-Verfügbarkeit | avc1-Formate verfügbar | Nur vp9/av01 oder SABR-Streams |
| JS-Runtime | Verfügbar (Bun läuft) | Nicht verfügbar im yt-dlp Kontext |

---

## 3. Implementierter Fix (REQ-042)

Branch: `fix/sabr-format-fallback`

### Neue Funktion: `isHlsSubFormatId()`

Erkennt Format-IDs mit `-N` Suffix (z.B. `301-0`, `234-1`) als nicht-portable HLS-Sub-Formate.
Diese IDs verweisen auf HLS-Playlist-Einträge, die session-spezifisch sind und nicht zuverlässig
für einen späteren Download verwendet werden können.

### Erweiterte Fallback-Kette in `buildYtDlpDownloadCmd`

Bisherige Kette:
```
format_id → bv[vcodec^=avc1]
```

Neue Kette:
```
format_id (nur wenn kein HLS-Sub-ID) → bv[vcodec^=avc1] → bv[vcodec^=vp09] → bv[vcodec^=av01] → bv
```

HLS-Sub-Format-IDs werden beim Aufbau des Download-Commands übersprungen.

### Angepasste Logik in `parseYtDlpOutput`

Filtert beim Parsen der yt-dlp Ausgabe:
- SABR-Manifest-URLs (URLs die `manifest.googlevideo.com` enthalten)
- HLS-Sub-Format-IDs aus der Format-Selektion heraus

### Angepasste Logik in `shouldRetryWithoutFormatId`

HLS-Sub-Format-IDs lösen automatisch einen Retry ohne Format-Lock aus (entsprechend REQ-027-D).

---

## 4. Beobachtung: Bot joint kurz, verschwindet dann wieder

Der Sharkord-Bot erstellt Transport und Producer (sichtbar im Log), aber der Nutzer sieht ihn
nicht dauerhaft im Voice-Channel:

1. `createStream()` wird erst nach erfolgreichem yt-dlp-Download aufgerufen
2. yt-dlp schlägt fehl (SABR) → `cleanup()` wird aufgerufen
3. `cleanup()` entfernt den Stream-Handle → Bot verlässt den Channel
4. Nutzer sieht den Bot kurz erscheinen und wieder verschwinden

Das Verhalten ist ein Symptom des yt-dlp-Fehlers, kein eigenständiger Bug. Mit dem SABR-Fix
schlägt yt-dlp nicht mehr fehl, und der Bot bleibt im Channel.

---

## 5. Technische Referenzen

### Relevante Dateien

- `src/stream/yt-dlp.ts` — Hauptdatei des Fixes (Format-Selektion, Fallback-Kette, HLS-Sub-Erkennung)
- `src/stream/stream-manager.ts` — Stream-Lifecycle, createStream/cleanup Reihenfolge
- `docs/REQUIREMENTS.md` — REQ-042 (neu hinzugefügt)

### Externe Referenzen

- yt-dlp SABR Issue: https://github.com/yt-dlp/yt-dlp/issues/12482
- SABR-Erklärung: YouTube Server-Adaptive Bitrate — Streaming-Protokoll das den Download-Pfad
  serverseitig kontrolliert; nicht kompatibel mit direktem yt-dlp-Download einzelner Format-URLs

### Log-Erkennungsmerkmale für SABR-Probleme

```
Some web_safari client https formats have been skipped as they are missing a URL.
YouTube is forcing SABR streaming
```

```
Requested format is not available. Use --list-formats
```

---

## 6. Offene Punkte

- REQ-042 ist auf Branch `fix/sabr-format-fallback` — Tests und Merge stehen noch aus
- JS-Runtime-Verfügbarkeit in der Docker-Umgebung prüfen (yt-dlp nutzt JS für manche Extraktoren)
- Langzeit-Beobachtung nach Merge: Tritt SABR weiterhin auf? Dann ggf. `--extractor-args` evaluieren
