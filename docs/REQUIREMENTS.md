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
| REQ-001 | Nutzer kann ein YouTube-Video per URL oder Suchbegriff abspielen (`/vid-watch <url\|query>`) | Must |
| REQ-002 | Video wird als RTP-Stream (Video H264 + Audio Opus) via Mediasoup an alle Channel-Teilnehmer gestreamt | Must |
| REQ-003 | Alle Nutzer im Voice-Channel sehen frame-synchron denselben Stream (Server-Side Streaming) | Must |
| REQ-010 | Wiedergabe kann gestoppt werden (`/vid-stop`) — Stream + Queue werden beendet | Must |
| REQ-011 | Aktuell laufendes Video kann abgefragt werden (`/vid-nowplaying`) | Must |
| REQ-012 | Lautstärke kann angepasst werden (`/vid-volume <0-100>`) — wirkt ab nächstem Video | Should |
| REQ-013 | Stream kann pausiert und fortgesetzt werden (`/vid-pause`) | Should |
| REQ-034 | Pausierter Stream kann explizit fortgesetzt werden (`/vid-resume`). Wenn kein pausiertes Video vorhanden ist, liefert der Command eine klare Rückmeldung | Must |
| REQ-035 | Pro Voice-Channel darf nur **ein** aktives Video laufen. Ein weiterer Startversuch (`/vid-watch`) während aktiver Wiedergabe wird abgewiesen | Must |
| REQ-036 | Plugin-Setting **Full-Download-Modus** steuert den Startzeitpunkt von Video und Audio: aktiviert = vollständiger Download vor Wiedergabe, deaktiviert = Wiedergabe ohne vollständigen Download (progressiv/direct). Standardwert: deaktiviert | Should |
| REQ-036-A | **fullDownloadMode=true (Complete Download First):** Video und Audio warten bis vollständig heruntergeladen, dann startet ffmpeg mit Echtzeit-Pacing (`-re`), damit Wiedergabe nicht beschleunigt läuft. Resultat: deterministischer Start bei normaler Abspielgeschwindigkeit | Should |
| REQ-036-B | **fullDownloadMode=false (No Full Download Before Start):** Wiedergabe startet ohne vollständigen Download. Audio und Video nutzen progressives Temp-File-Streaming mit initialem Buffer-Start. Resultat: schneller Start bei langen Videos | Should |
| REQ-037 | Wenn `debugMode=false`, werden alle während der Session heruntergeladenen Video-/Audio-Dateien nach Nutzung automatisch gelöscht (Logs bleiben erhalten) | Must |
| REQ-038 | **Video/Audio-Progressive Stabilität bei fullDownloadMode=false:** Wiedergabe startet ohne vollständigen Download, muss aber vorzeitiges Stoppen vermeiden. Im progressiven Modus darf kein harter `format_id`-Lock erzwungen werden, damit yt-dlp einen fortlaufend lesbaren Download-Pfad (inkl. containergeeigneter Temp-Dateien) wählen kann. Im fullDownloadMode=true bleibt Format-Lock aktiv. Zusätzlich sollen Laufzeit-Logs die erwartete und erkannte Stream-Länge ausgeben, um Abbrüche sichtbar zu machen. | Must |
### Warteschlange (Queue)

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-004 | Videos können in eine Warteschlange eingereiht werden (automatisch wenn bereits ein Video läuft) | Must |
| REQ-005 | Warteschlange ist pro Voice-Channel isoliert | Must |
| REQ-006 | Warteschlange kann angezeigt werden (`/vid-queue`) | Must |
| REQ-007 | Videos können aus der Warteschlange entfernt werden (`/vid-remove <position>`) | Must |
| REQ-008 | Aktuelles Video kann übersprungen werden (`/vid-skip` → nächstes in Queue) | Must |
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

### Plugin-Settings UI Spezifikation (Sub-Requirements zu REQ-018)

| ID | Anforderung | Priorität |
|----|-------------|----------|
| REQ-018-A | **Video-Bitrate Einstellung:** Numerisches Eingabefeld für Video-Qualität. Bereich: 1000–12000 kbps. Speichert Wert persistent. Standardwert: 3000 kbps. | Should |
| REQ-018-B | **Audio-Bitrate Einstellung:** Numerisches Eingabefeld für Audio-Qualität. Bereich: 64–320 kbps. Speichert Wert persistent. Standardwert: 128 kbps. | Should |
| REQ-018-C | **Standard-Lautstärke Einstellung:** Range-Slider (0–100%). Speichert Wert persistent. Standardwert: 75%. Wird auf alle Channel-Teilnehmer beim Start neuer Videos angewendet. | Should |
| REQ-018-D | **Synchronisierungs-Modus:** Dropdown mit Optionen "Server-Streaming" (Standard) und "Client-Sync (Hybrid)" (REQ-014). Speichert Wert persistent. | Should |
| REQ-018-E | **Settings-Panel UI:** Admin-Settings-Komponente (`SettingsPanel`) zeigt alle Einstellungen (REQ-018-A bis REQ-018-D) in übersichtlicher Form mit farbcodierten Seiten-Linien und detaillierten Beschreibungen. | Should |
| REQ-018-F | **Hilfetexte & Validierung:** Jede Einstellung hat Beschreibung, Bereichsangabe und Empfehlungswerte. Client-seitige Validierung vor Speicherung. Felder mit ungiltigen Werten zeigen Fehler. | Should |
| REQ-018-G | **Persistierung & Backup:** Alle Einstellungen werden in Plugin-Context (oder Sharkord Config) persistent gespeichert. Fallback auf Standardwerte bei fehlender Konfiguration. Keine sensiblen Daten. | Should |
| REQ-018-H | **Benutzerfreundlichkeit:** SettingsPanel ist responsive, funktioniert auf Desktop und Mobile. Tastaturnavigation möglich (Tab-Reihenfolge). Hover-Effekte auf Buttons. Speichern-Button am Ende sichtbar. | Should |

### Stream-Vorbereitung & Fortschrittsanzeige

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-027 | **Download-Fortschritt in Debug-Logs:** Der aktuelle Download-/Vorbereitungs-Status (yt-dlp Auflösung, ffmpeg Pipe-Start, RTP-Streaming aktiv) wird als strukturierte Debug-Log-Einträge ausgegeben, wenn Debug-Modus (REQ-026) aktiviert ist. Beinhaltet: Phase (resolving → downloading → streaming), verstrichene Zeit, ggf. Dateigröße/Durchsatz. | Must |
| REQ-027-A | **yt-dlp Phasen-Logging:** Beim Resolve eines Videos werden die Phasen `RESOLVING` (yt-dlp --dump-json gestartet), `RESOLVED` (Metadaten empfangen, Titel + Dauer bekannt), und `FORMAT_SELECTED` (H.264-Format gewählt, URL-Länge) im Debug-Log dokumentiert. | Must |
| REQ-027-B | **ffmpeg/yt-dlp Pipe-Logging:** Nach Start der yt-dlp→ffmpeg Pipe werden die Phasen `DOWNLOADING` (yt-dlp begonnen), `PIPING` (ffmpeg empfängt Daten auf stdin), und `STREAMING` (erste RTP-Pakete gesendet) im Debug-Log protokolliert. | Must |
| REQ-027-C | **Erweitertes yt-dlp Debug-Logging:** Im Debug-Modus wird yt-dlp mit verbose Output gestartet und die vollständige Command-Line geloggt (ohne Kürzung), um Download-Probleme zu diagnostizieren. | Must |
| REQ-027-D | **Format-Lock Fallback bei yt-dlp Download:** Wenn ein aufgelöstes `format_id` beim Download mit `Requested format is not available` fehlschlägt, wird automatisch ein einmaliger Retry ohne harten `format_id`-Lock gestartet (gleiche Quelle, gleicher Temp-File-Pfad). So bleibt der Stream startbar, obwohl die Resolve-Formatliste zwischen zwei yt-dlp Aufrufen abweicht. | Must |
| REQ-028 | **Ladebalken-UI für Vorbereitungsstatus:** Dem Nutzer wird in der Voice-Channel-UI ein visueller Fortschrittsindikator angezeigt, der den aktuellen Vorbereitungsstatus des Videos darstellt. Phasen: „Video wird aufgelöst…" → „Download wird vorbereitet…" → „Stream wird gestartet…" → „▶ Läuft". Der Indikator verschwindet, sobald der Stream läuft. | Should |
| REQ-028-A | **Fortschrittsphasen-Modell:** Vorbereitung wird in 4 diskrete Phasen aufgeteilt: (1) `RESOLVING` — yt-dlp sucht/prüft Video-URL, (2) `PREPARING` — Transport+Producer werden erstellt, (3) `BUFFERING` — yt-dlp→ffmpeg Pipe läuft, wartet auf erste RTP-Pakete, (4) `STREAMING` — RTP-Daten fließen, Video ist live. Jede Phase hat einen zugehörigen Prozent-Bereich: 0–25%, 25–50%, 50–90%, 90–100%. | Should |
| REQ-028-B | **Stream-Status via `streamHandle.update()`:** Der aktuelle Vorbereitungsstatus wird über `streamHandle.update({ title })` an Sharkord übermittelt (Titel-Update mit Phasen-Prefix wie „⏳ Wird vorbereitet… — Videotitel"). Sobald Streaming aktiv, wird der Titel auf den normalen Videotitel zurückgesetzt. | Should |
| REQ-028-C | **Timeout & Fehlerfall:** Wenn die Vorbereitung nach 30 Sekunden nicht die Phase `STREAMING` erreicht hat, wird ein Warnhinweis im Log und optional in der UI angezeigt. Bei Fehler wird der User über die Command-Response informiert. | Should |

### Wiedergabe-Steuerung über UI (ohne Texteingabe)

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-029 | **Play/Pause-Button in der Stream-UI:** Nutzer können das Video ohne Texteingabe per Klick pausieren und fortsetzen. Der Button zeigt den aktuellen Zustand an (▶ Play / ⏸ Pause). Wird über die Sharkord Plugin-UI (Stream-Overlay oder Voice-Channel-Komponente) bereitgestellt. | Must |
| REQ-029-A | **Button-Zustandssynchronisation:** Der Play/Pause-Button spiegelt den tatsächlichen Server-Status wider. Wenn ein anderer Nutzer per `/pause`-Command pausiert, aktualisiert sich der Button bei allen Nutzern. State-Sync erfolgt über Sharkord-Events oder Polling. | Should |
| REQ-030 | **Stop-Button in der Stream-UI:** Nutzer können den gesamten Stream (Video + Audio + Queue) per Klick beenden, ohne `/vid-stop` tippen zu müssen. Der Button ist deutlich als „destruktive Aktion" erkennbar (z.B. rot/rot-Umrandung oder ⏹-Icon). | Must |
| REQ-030-A | **Bestätigungsdialog (optional):** Vor dem Stoppen kann optional ein Bestätigungsdialog erscheinen („Stream wirklich beenden? Queue wird geleert."), um versehentliches Beenden zu vermeiden. Dies ist konfigurierbar oder entfällt, wenn die UI-Limitierungen es nicht erlauben. | Could |
| REQ-031 | **Skip-Button in der Stream-UI:** Nutzer können zum nächsten Video in der Queue springen, ohne `/skip` tippen zu müssen. Der Button ist nur sichtbar/aktiv, wenn die Queue weitere Videos enthält. | Should |

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
| REQ-026-A | **Formatierte Settings-Anzeige im Debug-Modus:** Wenn `debugMode=true` und ein Stream startet, werden alle aktiven Plugin-Einstellungen (Video-/Audio-Bitraten, Volume, Sync-Mode, Full-Download-Mode, Debug-Status) in ansprechend formatierter Form mit Emojis und visuellen Trennzeichen in der Chat-Ausgabe angezeigt. Dies erleichtert das Debugging von Stream-Problemen durch sofortige Sichtbarkeit der konfigurierten Werte. | Should |
| REQ-039 | **Settings-Logging bei Start und Änderung:** Alle Plugin-Einstellungen (videoBitrate, audioBitrate, defaultVolume, syncMode, fullDownloadMode, debugMode) werden bei Plugin-Start und bei jeder Änderung/Speicherung als strukturierter UND lesbarer Log-Eintrag ausgegeben. Das Logging erfolgt immer, unabhängig vom Debug-Modus. Für Laufzeitfälle mit verzögerter/staler `settings.get`-Sicht wird zusätzlich ein Event-Payload-Fallback ausgewertet, damit wirksame Werte sofort im Stream-Start angewendet werden. | Must |
| REQ-040 | **Build-Version enthält Build-Zeitstempel:** Die in `dist/sharkord-vid-with-friends/package.json` geschriebene Plugin-Version enthält einen Build-Postfix im Format `DDMMYY-HH-MM-SS` (z. B. `070326-15-04-09`) und wird loader-kompatibel als `<basisversion>-<DDMMYY-HH-MM-SS>` geschrieben. Zusätzlich wird ein lesbares Trace-Feld `sharkordVersionTrace` im Format `<basisversion>:<DDMMYY_HH_MM_SS>` geschrieben. Damit ist jeder Build eindeutig zeitlich rückverfolgbar, ohne Plugin-Loader zu brechen. | Must |
| REQ-041 | **Bug-Report Command:** `/vid-bugreport <description>` erstellt automatisch ein anonymisiertes GitHub Issue. Enthält: Problembeschreibung, Plugin-Version, aktuelle Settings (ohne Secrets), die letzten ~100 Zeilen aus dem Sharkord combined.log (anonymisiert: User-IDs durch Platzhalter ersetzt, URLs auf Domain gekürzt), sowie den aktuellen Queue/Stream-Status. GitHub-Token wird als Plugin-Setting `githubToken` konfiguriert. Ohne Token wird stattdessen ein formatierter Report-Text zurückgegeben der manuell gepostet werden kann. | Should |
| REQ-032 | **Debug-Cache für Downloads:** Im Debug-Modus wird der yt-dlp Download parallel in eine lokale Datei geschrieben (Video/Audio separat), um die Download-Funktion unabhängig vom RTP-Pfad prüfen zu können. | Should |
| REQ-033 | **`/vid-debug-cache` Command:** Zeigt alle gecachten Download-Dateien (Video/Audio) mit Größe und Zeitstempel an. Ermöglicht Nutzer, heruntergeladene Dateien zu inspizieren und vom Host aus (via Docker-Volume `./debug-cache/`) herunterzuladen. Nur verfügbar wenn Debug Output aktiv ist. | Should |

## REQ-043 — AV-Sync Diagnosefähigkeit und Korrektur

**Priorität:** Should

Das Plugin MUSS im Debug-Modus AV-Sync-Abweichungen messbar und im Log sichtbar machen sowie in beiden Streaming-Modi aktive Gegenmaßnahmen anwenden:

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-043-A | **AV-Sync Diagnosemessung im Debug-Modus:** Wenn `debugMode=true` und ein Stream läuft, wird die AV-Sync-Abweichung (Audio-PTS minus Video-PTS in Millisekunden) mindestens alle 5 Sekunden aus den ffmpeg-Statistiken extrahiert und als strukturierter Log-Eintrag ausgegeben. Werte außerhalb des Toleranzbereichs (±40 ms) werden als Warnung markiert. | Should |
| REQ-043-B | **AV-Sync Korrektur im Full-Download-Modus:** Im `fullDownloadMode=true` MUSS ffmpeg mit explizitem PTS-Alignment gestartet werden: Audio-Track und Video-Track erhalten vor dem Mux-Schritt einen PTS-Reset, sodass beide Streams bei Zeitstempel 0 beginnen. Eine messbare AV-Abweichung größer 100 ms bei der ersten gemessenen Stichprobe nach REQ-043-A gilt als Fehler und wird als Warnung geloggt. | Should |
| REQ-043-C | **AV-Sync Best Practices im Streaming-Modus:** Im `fullDownloadMode=false` MUSS ffmpeg mit AV-Sync-stabilisierenden Parametern gestartet werden (z. B. Audio-Resync-Schwelle, Vsync-Modus, PTS-Reset am Pipe-Eingang). Die gewählten Parameter werden im Debug-Modus als Log-Eintrag ausgegeben, damit sie nachvollziehbar und anpassbar sind. | Should |

---

## REQ-044 — Stream-Stabilität und Watchdog im Streaming-Modus

**Priorität:** Must

Das Plugin MUSS im Streaming-Modus (`fullDownloadMode=false`) erkennen, wenn ffmpeg oder yt-dlp unerwartet beendet werden, und zwischen normalem Ende und vorzeitigem Abbruch unterscheiden:

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-044-A | **Stream-Watchdog:** Nach dem Start eines Streams prüft ein Watchdog-Mechanismus zyklisch (mindestens alle 5 Sekunden), ob der ffmpeg-Prozess und der yt-dlp-Prozess noch aktiv sind. Ist ein Prozess unerwartet beendet, wird der Abbruch als Fehler-Event behandelt und nicht als normales Stream-Ende. | Must |
| REQ-044-B | **Unterscheidung normales Ende vs. vorzeitiger Abbruch:** Das Plugin MUSS beim Prozessende den Exit-Code und den Zeitpunkt des Endes gegen die erwartete Video-Dauer prüfen. Ein Exit-Code 0 und ein Endzeitpunkt innerhalb von ±10 Sekunden der aufgelösten Video-Dauer gilt als normales Ende. Alle anderen Fälle gelten als vorzeitiger Abbruch und werden als solche geloggt und behandelt. | Must |
| REQ-044-C | **Automatischer Retry bei vorzeitigem Abbruch:** Bei einem erkannten vorzeitigen Abbruch (REQ-044-B) startet das Plugin den Stream für denselben Queue-Eintrag automatisch neu — maximal 2 Wiederholungsversuche, mit einer Wartezeit von 3 Sekunden vor jedem Retry. Nach Ausschöpfen aller Versuche wird der Eintrag aus der Queue entfernt und der Nutzer über die fehlgeschlagene Wiedergabe informiert. | Must |
| REQ-044-D | **Watchdog-Logging:** Jeder Watchdog-Alarm, jeder Retry-Versuch und der endgültige Fehlschlag werden als strukturierte Log-Einträge (unabhängig vom Debug-Modus) ausgegeben, damit Abbruchursachen nachvollziehbar sind. | Must |

---

## REQ-042 — Robuste Format-Selektion bei SABR-Streaming

**Priorität:** Must
**Status:** Implementiert

Das Plugin MUSS beim YouTube-Download robust gegen SABR-Streaming (Server-Adaptive Bitrate) sein:

- REQ-042-A: HLS-Sub-Format-IDs (Format `NNN-N`, z.B. `301-0`) müssen erkannt und der Locked-Format-Pfad übersprungen werden
- REQ-042-B: Der Video-Fallback-Selektor muss neben avc1 auch vp09 und av01 Formate unterstützen
- REQ-042-C: SABR-Manifest-URLs (manifest.googlevideo.com) müssen aus der Format-Selektion ausgeschlossen werden
- REQ-042-D: Der Fallback `bv` (beliebiges bestes Video) muss als letzter Ausweg verfügbar sein

**Hintergrund:** YouTube erzwingt SABR für bestimmte Server-IPs. Alle avc1-Formate können auf betroffenen Servern nicht per yt-dlp heruntergeladen werden. Referenz: yt-dlp/yt-dlp#12482

---

## REQ-045 — CDN-URL-Fallback bei vollständigem SABR-Block

**Priorität:** Must
**Status:** Implementiert

Wenn yt-dlp mit `Requested format is not available` fehlschlägt — auch nach dem formatId-Fallback — MUSS das Plugin einen zweiten Retry mit der pre-resolved CDN-URL (`sourceUrl`) direkt starten, statt die YouTube-URL erneut aufzulösen.

- REQ-045-A: Nach zweimaligem Fehlschlag (locked format + generic format-selector) MUSS die direkte CDN-URL (`sourceUrl`) als letzter Fallback verwendet werden
- REQ-045-B: Im CDN-Fallback wird yt-dlp mit der URL direkt (ohne `-f` Format-Selektor) gestartet — so übernimmt yt-dlp das native Format der URL
- REQ-045-C: Der CDN-Fallback MUSS nur ausgelöst werden wenn die `sourceUrl` eine googlevideo.com-URL ist (kein YouTube-Watch-Link), um keine unendliche Retry-Schleife zu erzeugen
- REQ-045-D: Jeder CDN-Fallback-Retry MUSS geloggt werden (unabhängig vom Debug-Modus)

**Hintergrund:** YouTube kann für bestimmte Server-IPs ALLE DASH/MP4-Formate durch SABR ersetzen. In diesem Fall schlägt jeder yt-dlp Format-Selektor gegen die YouTube-URL fehl (`Requested format is not available`). Die CDN-URL selbst (googlevideo.com) ist jedoch direkt downloadbar, da sie bereits auf den richtigen Stream zeigt.

---

## REQ-046 — Bot-Antworten als Klartext

**Priorität:** Must
**Status:** Offen

Alle Antwort-Texte des Bots (Command-Responses) MÜSSEN als reiner Plaintext ausgegeben werden — kein YAML, kein JSON, kein Markdown-Code-Block, keine strukturierten Datenformate. Ziel ist eine für den Nutzer natürlich lesbare Ausgabe im Chat.

- REQ-046-A: Command-Responses dürfen ausschließlich natürlichsprachlichen Text enthalten (z. B. „Jetzt läuft: Videotitel — 4:06 min")
- REQ-046-B: Technische Werte (Bitrate, URLs, Format-IDs etc.) dürfen nur dann angezeigt werden, wenn sie für den Nutzer im jeweiligen Kontext relevant und verständlich sind
- REQ-046-C: Bestehende Commands, die strukturierte Daten zurückgeben (z. B. Objekte, Arrays, YAML-ähnliche Felder), MÜSSEN auf Plaintext umgestellt werden

---

## REQ-047 — Debug-Modus-Anzeige beim Abspielen

**Priorität:** Should
**Status:** Offen

Wenn der Debug-Modus aktiv ist (`debugMode=true`), MUSS die Bot-Antwort bei allen Commands, die eine Wiedergabe starten (z. B. `vid-watch`), den aktuell aktiven Stream-Modus als lesbaren Hinweis enthalten.

- REQ-047-A: Der Hinweis MUSS den Modus klar benennen: z. B. `[Debug] Modus: Full-Download` oder `[Debug] Modus: Streaming (progressiv)`
- REQ-047-B: Der Hinweis MUSS nur erscheinen wenn `debugMode=true` — im normalen Betrieb bleibt die Antwort davon unberührt
- REQ-047-C: Der Hinweis soll zusätzlich zum normalen Response-Text angezeigt werden, nicht als Ersatz

---

## REQ-048 — Streaming-Modus: Sofortiger CDN-Fallback bei yt-dlp-Fehler

**Priorität:** Must
**Status:** Implementiert

Im Streaming-Modus (progressive download) MUSS der Buffer-Wait-Loop sofort abbrechen, wenn yt-dlp mit einem Fehler-Exit-Code beendet wurde, anstatt die vollen 30 Sekunden abzuwarten.

- REQ-048-A: Im 100ms-Polling-Tick des Buffer-Wait-Loops MUSS geprüft werden ob `ytDlpExitCode !== null && ytDlpExitCode !== 0 && ytDlpExitCode !== 143`. Wenn ja, MUSS der Loop sofort abgebrochen werden.
- REQ-048-B: Nach dem Early-Exit greift die bestehende Retry-Kette (maybeRetryYtDlpWithoutFormatId → maybeRetryWithCdnUrl) ohne zusätzliche Wartezeit.
- REQ-048-C: Der Early-Exit MUSS geloggt werden: `[yt-dlp] Exited with code X — aborting buffer wait early`

**Hintergrund:** Auf SABR-geblockten Servern schlägt yt-dlp nach ~2–3s fehl. Ohne Early-Exit wartet der Loop stur 30s bevor der CDN-Fallback ausgelöst wird — Gesamtverzögerung ~60–90s. Mit Early-Exit sinkt die Verzögerung auf ~5–10s.

---

## REQ-049 — Korrekter Log-Pfad für Temp-Dateien

**Priorität:** Could
**Status:** Implementiert

Der Log-Eintrag für den Temp-Datei-Pfad beim Start des yt-dlp-Downloads MUSS den vollständigen Dateinamen ausgeben, nicht einen durch Magic-Number-Substring abgeschnittenen Pfad.

- REQ-049-A: Statt `tempFilePath.substring(Math.max(0, tempFilePath.length - 40))` MUSS `path.basename(tempFilePath)` verwendet werden, um den Dateinamen vollständig und korrekt anzuzeigen.

**Hintergrund:** Der aktuelle Code schneidet den Dateinamen ab (z.B. `emp-audio-...` statt `temp-audio-...`) weil die feste Zahl 40 kleiner als der Dateiname ist. `path.basename()` gibt immer den kompletten Dateinamen zurück, unabhängig von der Pfadlänge.

---

## REQ-050 — Adaptiver Audio-Delay: Reset bei Modus-Wechsel

**Priorität:** Should
**Status:** Implementiert

Beim Wechsel zwischen Full-Download-Modus und Streaming-Modus MUSS der gespeicherte adaptive Audio-Delay-Wert für den Channel zurückgesetzt werden, da die adaptierten Werte eines Modus nicht auf den anderen übertragbar sind.

- REQ-050-A: Vor jedem Stream-Start MUSS geprüft werden, ob sich der Modus (fullDownloadMode) gegenüber dem letzten Stream auf demselben Channel geändert hat.
- REQ-050-B: Bei einem Moduswechsel MUSS `adaptiveAudioDelayMsByChannel.delete(channelId)` aufgerufen werden, bevor `getAdaptiveAudioDelayMs()` den initialen Delay-Wert ermittelt.
- REQ-050-C: Der Reset MUSS geloggt werden: `[SYNC] Mode changed (fullDownload: X → Y) — resetting adaptive audio delay`

**Hintergrund:** Full-Download-Modus speichert adaptive Werte ~600ms, Streaming-Modus startet bei 650ms. Ohne Reset erbt der Streaming-Modus den Full-Download-Wert und startet mit falscher AV-Synchronisation.

---

## REQ-051 — Plattform-Migration auf Sharkord/SDK 0.0.16

**Priorität:** Must
**Status:** Offen

Das Repository MUSS vollständig auf Sharkord `v0.0.16` und die überarbeitete SDK-Version `0.0.16` migriert werden, inklusive Laufzeit-, Docker-, Agenten- und Dokumentationsbezügen.

- REQ-051-A: Der Dev-Stack MUSS `sharkord/sharkord:v0.0.16` verwenden
- REQ-051-B: Die Plugin-Metadaten und Entwicklungsabhängigkeiten MÜSSEN `@sharkord/plugin-sdk` und `@sharkord/shared` auf Version `0.0.16` referenzieren
- REQ-051-C: Nutzer- und Entwicklerdokumentation MUSS Sharkord `>= 0.0.16` als Mindestversion ausweisen
- REQ-051-D: Agenten-Anleitungen (`.github/agents` und `.claude/agents`) MÜSSEN die Zielplattform konsistent als SDK `0.0.16` beschreiben
- REQ-051-E: Die Migration MUSS in einer dedizierten Conclusions-Datei nachvollziehbar dokumentiert werden (Dateien, Änderungen, Validierung)

---

## REQ-052 — Voice-Action API-Kompatibilität für Sharkord 0.0.16

**Priorität:** Must
**Status:** Implementiert

Beim Start eines Streams MUSS das Plugin die Voice-Actions robust gegen unterschiedliche Runtime-Formen auflösen, damit `vid-watch` nicht an API-Shape-Unterschieden scheitert.

- REQ-052-A: Das Plugin MUSS Voice-Actions sowohl aus `ctx.actions.voice.*` als auch aus flachen `ctx.actions.*` Signaturen auflösen können.
- REQ-052-B: Zusätzlich sollen kompatible Alias-Namen unterstützt werden (`getVoiceRouter`/`getMediasoupRouter`, `getWebRtcListenInfo`/`getRtpListenInfo`, `addExternalStream`).
- REQ-052-C: Bei fehlender Voice-API MUSS eine präzise Fehlermeldung mit verfügbaren Action-Keys erzeugt werden, um Runtime-Diagnose zu erleichtern.

---

## Traceability

Jeder Test MUSS mit dem Format `[REQ-xxx]` auf eine oder mehrere Anforderungen
verweisen. Jeder Commit MUSS im Format `feat(REQ-xxx): ...` oder `test(REQ-xxx): ...`
eine Anforderung referenzieren.

**Hierarchische IDs:** Sub-Requirements verwenden das Format `REQ-XXX-A`, `REQ-XXX-B` etc.,
um ihre Beziehung zur übergeordneten Anforderung zu zeigen. Z.B. `REQ-018-A` ist eine
Spezifizierung von `REQ-018`.

**Ausnahme:** Commits vom Typ `docs` benötigen keine REQ-ID (z. B. `docs: update README`).
