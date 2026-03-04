# Quick Test Protocol — sharkord-vid-with-friends

**Dauer:** ~5 Minuten  
**Ziel:** Schnelle Validierung der Kern-Funktionalität  
**Voraussetzung:** Sharkord v0.0.6 laufen, Plugin geladen

---

## 1. Setup (1 min)

- [ ] Sharkord läuft auf `http://localhost:3000`
- [ ] Plugin `sharkord-vid-with-friends` im Voice-Channel verfügbar
- [ ] Debug-Modus in Settings: **auf OFF** (schneller Test)
- [ ] Voice-Channel offen mit mindestens 1 Client verbunden

**Log-Check:** Plugin sollte Meldung zeigen: `Plugin loaded: sharkord-vid-with-friends`

---

## 2. Command Test: /watch (1 min)

### Test 2a: Valide URL
```
Execute: /watch https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**✓ Erwartet:**
- [ ] Command akzeptiert, nicht abgewiesen
- [ ] "Spielvideo wird vorbereitet..." oder ähnliche Meldung
- [ ] Nach ~3-5 Sekunden: Video startet auf allen Clients
- [ ] Audio und Video synchron (kein Desync sichtbar)

### Test 2b: Query-Suche
```
Execute: /watch rickroll
```

**✓ Erwartet:**
- [ ] Video wird automatisch gefunden und gestartet
- [ ] Titel in UI sichtbar (z.B. "Rick Astley - Never Gonna Give You Up")

---

## 3. Queue & Playback (1.5 min)

### Test 3a: Queue anzeigen
```
Execute: /queue
```

**✓ Erwartet:**
- [ ] Zeigt "Currently playing: [Video 1]"
- [ ] Queue ist leer (wenn noch kein zweites Video hinzugefügt)

### Test 3b: Video zur Queue hinzufügen
```
Execute: /watch https://www.youtube.com/watch?v=jNQXAC9IVRw
```

**✓ Erwartet:**
- [ ] Command zeigt: "Video zur Warteschlange hinzugefügt" oder ähnlich
- [ ] `/queue` zeigt jetzt 2 Videos

---

## 4. Controls (1.5 min)

### Test 4a: Pause/Resume
```
Execute: /pause
```

**✓ Erwartet:**
- [ ] Video pausiert (kein Audio mehr)
- [ ] Überschrift zeigt Pause-Status

```
Execute: /pause  (oder /resume)
```

**✓ Erwartet:**
- [ ] Video läuft weiter

### Test 4b: Skip
```
Execute: /skip
```

**✓ Erwartet:**
- [ ] Video stoppt sofort
- [ ] Nächstes Video (falls in Queue) startet automatisch
- [ ] Wenn Queue leer: Stream stoppt mit "Playlist beendet"

### Test 4c: Stop
```
Execute: /watch_stop
```

**✓ Erwartet:**
- [ ] Stream stoppt komplett
- [ ] Queue geleert
- [ ] Keine weiteren Videos laufen

---

## 5. Settings Test (optional, 30 sec)

- [ ] Öffne Admin Settings
- [ ] Ändere "Video Bitrate" auf 2000
- [ ] Ändere "Default Volume" auf 50
- [ ] Speichern
- [ ] Starte neues Video mit `/watch`
- [ ] Beobachte: Neue Einstellungen sollten angewendet sein

---

## 6. Final Checks ✓

| Check | Status |
|-------|--------|
| Keine Error-Logs in Konsole | ✓ |
| Video läuft auf allen Clients | ✓ |
| Audio synchron | ✓ |
| Commands angenommen | ✓ |
| Keine Crashes | ✓ |

---

## Ergebnis

- **PASS:** Wenn alle ✓ Checks erfüllt sind
- **FAIL:** Wenn eines der Checks fehlschlägt → Screenshot machen, Logs checken, Fehler dokumentieren

---

## Debug-Tipps bei Problemen

### Video startet nicht
1. Prüfe: `/nowplaying` — zeigt aktuelles Video?
2. Prüfe Logs: `[stream:X]` mit Fehlern?
3. Prüfe FFmpeg: `src/stream/ffmpeg.ts` Zeile 387+

### Audio-Desync
1. Prüfe Bitrates in Settings
2. Prüfe `-re Flag` in Logs (sollte "ON (progressive)" sein)
3. Set `fullDownloadMode=true` in Settings und retry

### Command wird nicht akzeptiert
1. Prüfe: Bist du im Voice-Channel?
2. Prüfe: Ist Plugin wirklich geladen?
3. Prüfe Logs: `[ERR]` Meldungen?

**More Info:** Siehe [docs/REQUIREMENTS.md](REQUIREMENTS.md) für detaillierte Anforderungen
