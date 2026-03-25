# Session-Erkenntnisse: Streaming-Modus Analyse (2026-03-26)

**Datum:** 2026-03-26
**Plugin-Version:** v0.1.0-alpha.8
**Branch:** fix/streaming-mode-cdn-fallback (offen), main
**Log-Quelle:** log_local.txt (Session 00:20–00:25 Uhr, Remote-Server)

---

## Kontext

Der Remote-Server ist von YouTube dauerhaft mit SABR-Streaming blockiert — alle DASH/MP4-Formate
sind nicht verfügbar, nur SABR-Manifeste werden geliefert. Der CDN-URL-Fallback (REQ-045) wurde
im vorherigen Commit eingeführt. Diese Session testet das Verhalten beider Modi (Full-Download und
Streaming) unter SABR-Bedingungen erstmals im produktiven Einsatz.

---

## Erkenntnisse

### Erkenntnis 1: CDN-Fallback (REQ-045) funktioniert im Full-Download-Modus korrekt ✅

**Zeitraum:** 00:23:19–00:23:31

Ablauf:
1. `00:23:23` — yt-dlp startet mit locked formatId `137` (Video) und `140` (Audio)
2. `00:23:26` — Beide scheitern: `Requested format is not available` (SABR-Block, exit 1)
3. `00:23:26` — Retry ohne formatId-Lock → generic selector → scheitert ebenfalls (exit 1)
4. `00:23:29` — **CDN-Fallback greift:** `All YouTube format selectors failed (SABR block). Retrying with pre-resolved CDN URL...`
5. `00:23:31` — yt-dlp: `Identified a direct video link` → `Invoking http downloader` → Download läuft

**Fazit:** REQ-045 funktioniert korrekt. Der dritte Retry mit der googlevideo.com-URL umgeht den
SABR-Block erfolgreich. Beide Tracks (Video + Audio) durchlaufen die komplette Retry-Kette.

---

### Erkenntnis 2: CDN-Fallback im Streaming-Modus funktioniert — aber mit 30s Verzögerung ⚠️

**Zeitraum:** 00:25:01–00:25:34+ (geschätzt)

Ablauf:
1. `00:25:04` — yt-dlp startet mit generic selector (kein locked format im Streaming-Modus)
2. `00:25:06` — SABR-Block → `Requested format is not available` (exit 1 nach ~2s)
3. `00:25:06` — **yt-dlp ist fertig (exit 1)**, aber der Buffer-Wait-Loop läuft weiter
4. `00:25:34` — (30s später) Buffer-Loop endet, `maybeRetryWithCdnUrl()` wird aufgerufen
5. `00:25:34+` — CDN-Fallback startet, Download läuft, Buffer füllt sich bis 10MB (~30–60s)
6. Erst dann: ffmpeg startet → Video erscheint beim User

**Gesamtverzögerung: ~60–90s** statt erwarteter ~5s.

**Root Cause:**
Der Buffer-Wait-Loop in `spawnFfmpeg()` (Progressive-Modus) hat keine Early-Exit-Logik:

```typescript
for (let i = 0; i < 300; i++) {  // 30 Sekunden Timeout
  if (existsSync(tempFilePath)) {
    const fileSize = Bun.file(tempFilePath).size;
    if (fileSize >= minInitialBytes) { fileReady = true; break; }
  }
  // FEHLT: if (ytDlpExitCode !== null && ytDlpExitCode !== 0) break;
  await new Promise<void>(r => setTimeout(r, 100));
}
```

Der Loop wartet stur 30 Sekunden, obwohl `ytDlpExitCode` bereits nach 2s auf `1` gesetzt ist.
Danach kommt erst der Retry ohne formatId (`maybeRetryYtDlpWithoutFormatId` → gibt false zurück,
weil kein `preferredFormatId` im Streaming-Modus) und dann erst der CDN-Fallback.

**User-Beobachtung:** "Video kam SEHR verspätet" — bestätigt die Analyse.

---

### Erkenntnis 3: Konkurrenz-Problem — vid-watch während laufendem Stream ⚠️

**Zeitraum:** 00:23:58–00:24:51

1. `00:23:58` — User schaltet `fullDownloadMode` von `true` auf `false` — während der CDN-Download
   von Stream #1 noch läuft (kein Log-Ende für Stream #1 sichtbar)
2. `00:24:08` — Zweiter `vid-watch` ausgeführt (Streaming-Modus) — kein Fehler im Log
3. `00:24:51` — `vid-stop`

Unklar: Hat REQ-035 (Single-Stream-Guard) gegriffen? Kein `"Stream already active"` Fehler
sichtbar. Möglicherweise wurde Stream #1 durch das Settings-Update implizit invalidiert oder
der Guard hat den zweiten Start blockiert ohne sichtbaren Log-Eintrag.

**Offene Frage:** Settings-Änderungen während eines laufenden Streams — wirken sie sofort oder
erst ab dem nächsten Video? Das Verhalten muss explizit definiert und getestet werden (→ REQ-035).

---

### Erkenntnis 4: Log-Bug — abgeschnittener Temp-Datei-Pfad (kosmetisch) 🔧

```
[stream:3] [Phase] DOWNLOADING — yt-dlp pipe started on temp file: emp-audio-HrNzO3V7Ob0-....webm
```

Das führende `t` von `temp-` fehlt. Ursache in `ffmpeg.ts`:

```typescript
loggers.log(`[Phase] DOWNLOADING — yt-dlp pipe started on temp file: ${tempFilePath.substring(Math.max(0, tempFilePath.length - 40))}`);
```

Bei einem Pfad wie `/home/bun/.../temp-audio-HrNzO3V7Ob0-1774481104879.webm` (Länge ~72 Zeichen)
ergibt `substring(32)` → `emp-audio-...`. Der Dateiname ist 41 Zeichen lang, wird um 1 Zeichen
abgeschnitten. Fix: `path.basename(tempFilePath)` statt Magic-Number-Substring.

Kein funktionaler Einfluss, aber irreführend beim Log-Lesen.

---

### Erkenntnis 5: Adaptiver Audio-Delay nicht zurückgesetzt bei Modus-Wechsel ⚠️

- Full-Download-Modus (Stream #1): `[SYNC] Audio delay compensation: 600ms` — korrekt (statischer Wert)
- Streaming-Modus (Stream #3): `[SYNC] Audio delay compensation: 650ms` — woher?

Der Wert 650ms deutet auf einen **gespeicherten adaptiven Messwert** aus einem früheren Stream
desselben Channels (channel 3) hin, der nicht zurückgesetzt wurde. Beim Wechsel zwischen
Full-Download-Modus (Basiswert 600ms) und Streaming-Modus (Basiswert 0ms + Adaptive) sollte
der gespeicherte adaptive Wert für den Channel zurückgesetzt werden.

Auswirkung: Im Streaming-Modus startet Audio mit 650ms Verzögerung statt 0ms — möglicherweise
spürbare AV-Drift zu Beginn des Videos.

---

## Priorisierte Handlungsempfehlungen

| Prio | Schritt | Datei | Beschreibung |
|------|---------|-------|-------------|
| **HOCH** | Buffer-Loop Early Exit | `src/stream/ffmpeg.ts` | Im 100ms-Tick prüfen: `if (ytDlpExitCode !== null && ytDlpExitCode !== 0) break` → Verzögerung 30s → ~3s |
| **MITTEL** | Log-Bug Pfad | `src/stream/ffmpeg.ts` | `path.basename(tempFilePath)` statt `substring(length - 40)` |
| **MITTEL** | Audio-Delay Reset | `src/index.ts` | Adaptiven Delay-Wert beim Stream-Start zurücksetzen, nicht den Channel-Wert vom letzten Stream übernehmen |
| **NIEDRIG** | REQ-035 Settings-Verhalten | `src/index.ts` / Docs | Explizit definieren + testen: Settings-Änderungen gelten erst ab nächstem Video |

---

## Gesamtbewertung

Der CDN-Fallback (REQ-045) ist grundsätzlich funktionsfähig und löst das SABR-Problem.
Im Full-Download-Modus arbeitet er korrekt und mit akzeptabler Latenz (~6–10s für 2 fehlgeschlagene
Versuche + CDN-Download-Start).

Im Streaming-Modus ist der Fallback durch den fehlenden Early-Exit im Buffer-Loop unnötig langsam.
Das ist der dringendste offene Fix.
