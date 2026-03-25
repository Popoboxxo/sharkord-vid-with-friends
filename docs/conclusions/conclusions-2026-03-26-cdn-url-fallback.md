# Erkenntnisse — 26. März 2026 — CDN-URL-Fallback (REQ-045)

## Session-Zusammenfassung

Auf dem Remote-Server schlugen alle yt-dlp-Format-Selektoren fehl, weil YouTube SABR-Streaming
(Server Adaptive Bitrate) für die Server-IP erzwingt. Der bestehende Retry-Mechanismus
(`maybeRetryYtDlpWithoutFormatId`) reicht in diesem Fall nicht aus. Fix implementiert als REQ-045
auf Branch `fix/yt-dlp-format-unavailable`, Commit `c431cee`.

---

## 1. Bug-Beschreibung

### Fehlerbild auf dem Remote-Server

Auf dem Remote-Server (nicht lokal) schlägt yt-dlp konsistent mit folgendem Fehler fehl:

```
ERROR: [youtube] ye4hoPA48bI: Requested format is not available.
Use --list-formats for a list of available formats
```

Betroffen sind **alle** Versuche:
- Locked format-ID (z.B. `299`, `140-drc`)
- Generischer Fallback-Selektor (`ba/ba*`, `bv[vcodec^=avc1]...`)
- Jeder weitere Format-Selektor gegen die YouTube-URL

---

## 2. Root Cause: SABR-Enforcement durch YouTube

YouTube erzwingt für bestimmte Server-IPs **SABR (Server Adaptive Bitrate)**-Streaming. Der
Mechanismus ersetzt alle DASH/MP4-Formate durch SABR-Manifeste, die von yt-dlp nicht als
reguläre Download-URLs genutzt werden können.

**Erkennungsmerkmale im Log:**

```
Some web_safari client https formats have been skipped as they are missing a URL.
YouTube is forcing SABR streaming for this client.
```

```
Requested format is not available. Use --list-formats
```

**Effekte unter SABR:**
- Alle DASH/MP4-Formate in `--dump-json` erscheinen als "verfügbar", enthalten aber beim
  tatsächlichen Download keine direkt abrufbare URL mehr
- yt-dlp kann keine individuellen Format-IDs herunterladen
- Auch generische Selektoren wie `ba/ba*` schlagen fehl, weil kein Selektor ein
  herunterladbares Format findet
- Das Problem tritt nur auf Servern auf, die YouTube als "potenzielle Bot-Infrastruktur"
  einstuft — lokal (Docker, Consumer-IP) ist es nicht reproduzierbar

**Externe Referenz:** https://github.com/yt-dlp/yt-dlp/issues/12482

---

## 3. Warum der bisherige Retry-Mechanismus nicht hilft

Der vorhandene `maybeRetryYtDlpWithoutFormatId()`-Mechanismus (REQ-027) löst einen Retry ohne
locked formatId aus und ersetzt die ID durch generische Selektoren. Unter SABR findet jedoch
**kein** Format-Selektor ein downloadbares Format gegen die YouTube-URL — weder locked noch
generic. Der zweite Versuch schlägt mit dem identischen Fehler fehl.

---

## 4. Fix: CDN-URL als dritter Fallback (REQ-045)

### Kernidee

`resolveVideo()` ruft yt-dlp mit `--dump-json` auf und liefert für jedes Video bereits eine
pre-resolved `googlevideo.com`-URL im `streamUrl`/`audioUrl`-Feld. Diese URL zeigt direkt auf
den CDN-Stream und benötigt keine weitere Format-Selektion durch yt-dlp.

Wenn alle YouTube-URL-basierten Versuche fehlschlagen, wird yt-dlp als dritter Fallback mit
dieser CDN-URL direkt gestartet — ohne `-f` Format-Selektor.

### Neue Funktion: `shouldRetryWithCdnUrl()`

```typescript
export const shouldRetryWithCdnUrl = (
  exitCode: number | null,
  stderrText: string,
  sourceUrl: string,
  youtubeUrl?: string,
): boolean
```

**Trigger-Bedingungen (alle müssen erfüllt sein):**
- `exitCode` ist nicht `null`, `0` oder `143` (kein Erfolg, kein SIGTERM)
- `stderrText` enthält "Requested format is not available" (case-insensitive)
- `sourceUrl` enthält `googlevideo.com` (stellt sicher, dass eine direkte CDN-URL vorliegt)
- `youtubeUrl` ist gesetzt und nicht leer (verhindert infinite retry — wenn kein youtubeUrl,
  läuft der Download bereits im CDN-Pfad)

**Gibt `false` zurück wenn:**
- `sourceUrl` keine `googlevideo.com`-URL ist (Schutz gegen endlose Retry-Schleifen)
- `youtubeUrl` fehlt oder leer ist (bereits im CDN-Fallback-Pfad)
- Exit-Code signalisiert Erfolg oder intentionalen Kill

### Neue Funktion: `maybeRetryWithCdnUrl()` (intern)

```typescript
const maybeRetryWithCdnUrl = async (): Promise<boolean>
```

Interne Closure in `spawnFfmpegWithYtDlp`. Wird nach `maybeRetryYtDlpWithoutFormatId()` in
**beiden** Modi aufgerufen:
- Full-Download-Modus (wartet auf vollständigen Download vor ffmpeg-Start)
- Progressive-Modus (startet ffmpeg sobald genug Buffer vorhanden)

**Ablauf:**
1. Prüft `shouldRetryWithCdnUrl()` — gibt `false` zurück wenn Bedingungen nicht erfüllt
2. Setzt `usedCdnFallback = true` (verhindert Doppel-Retry)
3. Beendet laufenden yt-dlp-Prozess per SIGTERM
4. Löscht partielle Temp-Datei (best-effort)
5. Ruft `spawnYtDlpDownload(true, true)` auf — zweites `true` aktiviert CDN-Fallback

### Geänderte Funktion: `spawnYtDlpDownload(useFormatFallback, useCdnFallback)`

```typescript
const spawnYtDlpDownload = (useFormatFallback: boolean, useCdnFallback = false): void
```

Bei `useCdnFallback = true`:
- `effectiveYoutubeUrl = undefined` — YouTube-URL wird nicht übergeben
- `buildYtDlpDownloadCmd` nutzt dadurch den `else`-Zweig und setzt die `sourceUrl` direkt
  als Ziel, ohne `-f` Selektor

---

## 5. Vollständige Retry-Kette (3 Versuche)

| Versuch | Beschreibung | Format-Selektor | URL |
|---------|-------------|-----------------|-----|
| 1 | Locked formatId | `-f 299` (Beispiel) | YouTube-URL |
| 2 | Generischer Selektor | `bv[vcodec^=avc1]...` / `ba[acodec=opus]/...` | YouTube-URL |
| 3 (NEU) | CDN-URL-Fallback | Kein `-f` | `googlevideo.com` direkt |

Der dritte Versuch schlägt fehl wenn:
- `sourceUrl` keine `googlevideo.com`-URL ist (z.B. nur YouTube-URL bekannt)
- Das CDN-Stream-Token bereits abgelaufen ist (Expire-Parameter in der URL)

---

## 6. Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `src/stream/ffmpeg.ts` | `shouldRetryWithCdnUrl()` (neu, exportiert), `maybeRetryWithCdnUrl()` (intern), `spawnYtDlpDownload(useCdnFallback)` Parameter (erweitert), CDN-Fallback in Full-Download-Modus (Z. 752–758) und Progressive-Modus (Z. 820–829) |
| `docs/REQUIREMENTS.md` | REQ-045 mit Sub-Anforderungen A–D (neu hinzugefügt) |
| `tests/unit/cdn-url-fallback.test.ts` | 13 Unit-Tests (neu) |

---

## 7. Tests (REQ-045)

Datei: `tests/unit/cdn-url-fallback.test.ts`

**13 Tests, alle grün:**

`shouldRetryWithCdnUrl` (9 Tests):
- `[REQ-045-A]` Trigger bei format-not-available + CDN-URL als sourceUrl
- `[REQ-045-C]` Kein Trigger wenn sourceUrl eine YouTube-URL ist (Loop-Schutz)
- `[REQ-045-C]` Kein Trigger wenn youtubeUrl fehlt (bereits im CDN-Pfad)
- `[REQ-045-A]` Kein Trigger bei Exit-Code 0 (Erfolg)
- `[REQ-045-A]` Kein Trigger bei Exit-Code 143 (SIGTERM)
- `[REQ-045-A]` Kein Trigger bei Exit-Code null (Prozess läuft noch)
- `[REQ-045-A]` Kein Trigger bei anderem Fehlertext (z.B. Network timeout)
- `[REQ-045-A]` Case-insensitive Fehlererkennung
- `[REQ-045-C]` Trigger für beliebige googlevideo.com Subdomains

`buildYtDlpDownloadCmd — CDN fallback mode` (4 Tests):
- `[REQ-045-B]` sourceUrl wird direkt verwendet wenn youtubeUrl fehlt
- `[REQ-045-B]` Kein `-f` Format-Selektor im CDN-Fallback
- `[REQ-045-B]` Output-Pfad (`-o`) ist gesetzt
- `[REQ-045-B]` YouTube-URL wird genutzt wenn youtubeUrl vorhanden (normaler Pfad)

---

## 8. Branch & Commit

- **Branch:** `fix/yt-dlp-format-unavailable`
- **Commit:** `c431cee`

---

## 9. Abgrenzung zu REQ-042 (Session 2026-03-25)

REQ-042 (Branch `fix/sabr-format-fallback`) hat die generische Fallback-Kette erweitert
(`bv[vcodec^=vp09]`, `bv[vcodec^=av01]`, `bv`) und HLS-Sub-Format-IDs gefiltert. Das reicht
nicht aus, wenn YouTube SABR für **alle** Formate erzwingt — dann scheitert auch jeder
generische Selektor. REQ-045 ist die dritte Eskalationsstufe nach REQ-027 und REQ-042.

**Eskalationshierarchie:**
1. REQ-027: Retry ohne locked formatId (generischer Selektor statt fester ID)
2. REQ-042: Erweiterung der generischen Selektor-Kette (vp09/av01/bv als Fallback)
3. REQ-045: CDN-URL direkt (bypasses YouTube-URL-Auflösung vollständig)

---

## 10. Wichtige Referenzen

- `src/stream/ffmpeg.ts` — Implementierung `shouldRetryWithCdnUrl`, `maybeRetryWithCdnUrl`
- `tests/unit/cdn-url-fallback.test.ts` — Unit-Tests REQ-045
- `docs/REQUIREMENTS.md` — REQ-045 (Zeilen 161–175)
- yt-dlp SABR Issue: https://github.com/yt-dlp/yt-dlp/issues/12482
