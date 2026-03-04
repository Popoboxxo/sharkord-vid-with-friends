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
| REQ-034 | Pausierter Stream kann explizit fortgesetzt werden (`/resume`). Wenn kein pausiertes Video vorhanden ist, liefert der Command eine klare Rückmeldung | Must |
| REQ-035 | Pro Voice-Channel darf nur **ein** aktives Video laufen. Ein weiterer Startversuch (`/watch`) während aktiver Wiedergabe wird abgewiesen | Must |
| REQ-036 | Plugin-Setting **Full-Download-Modus** steuert den Startzeitpunkt von Video und Audio: aktiviert = vollständiger Download vor Wiedergabe, deaktiviert = Wiedergabe ohne vollständigen Download (progressiv/direct). Standardwert: deaktiviert | Should |
| REQ-036-A | **fullDownloadMode=true (Complete Download First):** Video und Audio warten bis vollständig heruntergeladen, dann startet ffmpeg ohne `-re`. Resultat: deterministischer Start und stabile Gesamtdauer | Should |
| REQ-036-B | **fullDownloadMode=false (No Full Download Before Start):** Wiedergabe startet ohne vollständigen Download. Audio nutzt progressives Temp-File-Streaming, Video nutzt progressiven Direkt-Input. Resultat: schneller Start bei langen Videos | Should |
| REQ-037 | Wenn `debugMode=false`, werden alle während der Session heruntergeladenen Video-/Audio-Dateien nach Nutzung automatisch gelöscht (Logs bleiben erhalten) | Must |
| REQ-038 | **Video-Progressive Stabilität bei fullDownloadMode=false:** Video darf ohne vollständigen Download starten, muss dabei aber eine Streaming-Methode verwenden, die das vorzeitige Stoppen (Freeze bei laufender Audio) verhindert. Bei fullDownloadMode=true bleibt Voll-Download vor Start aktiv. | Must |
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
| REQ-028 | **Ladebalken-UI für Vorbereitungsstatus:** Dem Nutzer wird in der Voice-Channel-UI ein visueller Fortschrittsindikator angezeigt, der den aktuellen Vorbereitungsstatus des Videos darstellt. Phasen: „Video wird aufgelöst…" → „Download wird vorbereitet…" → „Stream wird gestartet…" → „▶ Läuft". Der Indikator verschwindet, sobald der Stream läuft. | Should |
| REQ-028-A | **Fortschrittsphasen-Modell:** Vorbereitung wird in 4 diskrete Phasen aufgeteilt: (1) `RESOLVING` — yt-dlp sucht/prüft Video-URL, (2) `PREPARING` — Transport+Producer werden erstellt, (3) `BUFFERING` — yt-dlp→ffmpeg Pipe läuft, wartet auf erste RTP-Pakete, (4) `STREAMING` — RTP-Daten fließen, Video ist live. Jede Phase hat einen zugehörigen Prozent-Bereich: 0–25%, 25–50%, 50–90%, 90–100%. | Should |
| REQ-028-B | **Stream-Status via `streamHandle.update()`:** Der aktuelle Vorbereitungsstatus wird über `streamHandle.update({ title })` an Sharkord übermittelt (Titel-Update mit Phasen-Prefix wie „⏳ Wird vorbereitet… — Videotitel"). Sobald Streaming aktiv, wird der Titel auf den normalen Videotitel zurückgesetzt. | Should |
| REQ-028-C | **Timeout & Fehlerfall:** Wenn die Vorbereitung nach 30 Sekunden nicht die Phase `STREAMING` erreicht hat, wird ein Warnhinweis im Log und optional in der UI angezeigt. Bei Fehler wird der User über die Command-Response informiert. | Should |

### Wiedergabe-Steuerung über UI (ohne Texteingabe)

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| REQ-029 | **Play/Pause-Button in der Stream-UI:** Nutzer können das Video ohne Texteingabe per Klick pausieren und fortsetzen. Der Button zeigt den aktuellen Zustand an (▶ Play / ⏸ Pause). Wird über die Sharkord Plugin-UI (Stream-Overlay oder Voice-Channel-Komponente) bereitgestellt. | Must |
| REQ-029-A | **Button-Zustandssynchronisation:** Der Play/Pause-Button spiegelt den tatsächlichen Server-Status wider. Wenn ein anderer Nutzer per `/pause`-Command pausiert, aktualisiert sich der Button bei allen Nutzern. State-Sync erfolgt über Sharkord-Events oder Polling. | Should |
| REQ-030 | **Stop-Button in der Stream-UI:** Nutzer können den gesamten Stream (Video + Audio + Queue) per Klick beenden, ohne `/watch_stop` tippen zu müssen. Der Button ist deutlich als „destruktive Aktion" erkennbar (z.B. rot/rot-Umrandung oder ⏹-Icon). | Must |
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
| REQ-039 | **Settings-Logging bei Start und Änderung:** Alle Plugin-Einstellungen (videoBitrate, audioBitrate, defaultVolume, syncMode, fullDownloadMode, debugMode) werden bei Plugin-Start und bei jeder Änderung/Speicherung als strukturierter UND lesbarer Log-Eintrag ausgegeben. Das Logging erfolgt immer, unabhängig vom Debug-Modus. | Must |
| REQ-032 | **Debug-Cache für Downloads:** Im Debug-Modus wird der yt-dlp Download parallel in eine lokale Datei geschrieben (Video/Audio separat), um die Download-Funktion unabhängig vom RTP-Pfad prüfen zu können. | Should |
| REQ-033 | **`/debug_cache` Command:** Zeigt alle gecachten Download-Dateien (Video/Audio) mit Größe und Zeitstempel an. Ermöglicht Nutzer, heruntergeladene Dateien zu inspizieren und vom Host aus (via Docker-Volume `./debug-cache/`) herunterzuladen. Nur verfügbar wenn Debug Output aktiv ist. | Should |

## Traceability

Jeder Test MUSS mit dem Format `[REQ-xxx]` auf eine oder mehrere Anforderungen
verweisen. Jeder Commit MUSS im Format `feat(REQ-xxx): ...` oder `test(REQ-xxx): ...`
eine Anforderung referenzieren.

**Hierarchische IDs:** Sub-Requirements verwenden das Format `REQ-XXX-A`, `REQ-XXX-B` etc.,
um ihre Beziehung zur übergeordneten Anforderung zu zeigen. Z.B. `REQ-018-A` ist eine
Spezifizierung von `REQ-018`.

**Ausnahme:** Commits vom Typ `docs` benötigen keine REQ-ID (z. B. `docs: update README`).
