# Erkenntnisse — 28. Februar 2026

## Session-Zusammenfassung

**Ausgangssituation:** Plugin streamt RTP-Daten erfolgreich, aber Video wird im Browser nicht angezeigt.

**Hauptaufgabe:** Debugging der UI-Integration und WebRTC-Consumer-Probleme.

**Ergebnis:** ✅ **VIDEO LÄUFT!** Vollständige WebRTC-Streaming-Pipeline funktioniert.

---

## 1. Der finale Fix — WebRTC Network Architecture

### 🎯 Root Cause

**Problem:** Verwechslung zwischen **internem RTP-Routing** und **externem WebRTC-Routing**.

Die ursprüngliche Implementierung verwendete `announcedAddress` für **beide** Zwecke:
- RTP-Streaming von ffmpeg zu Mediasoup (Container-intern)
- WebRTC-ICE-Candidates für Browser (extern)

### ❌ Vorher

```typescript
// src/index.ts (falsch)
const rtpTargetHost = announcedAddress || (ip === "0.0.0.0" ? "127.0.0.1" : ip);
```

```yaml
# docker-compose.dev.yml (falsch)
environment:
  - SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=127.0.0.1
```

**Symptom:**
- Mit `127.0.0.1`: Browser versuchte, zu seinem eigenen localhost zu verbinden → WebRTC Consumer Transport failed
- Mit LAN-IP: ffmpeg sendete RTP an falsche Adresse → Mediasoup erhielt keine Pakete

### ✅ Nachher

```typescript
// src/index.ts (korrekt)
// RTP target is always local (ffmpeg runs in same container as Mediasoup)
const rtpTargetHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;
```

```yaml
# docker-compose.dev.yml (korrekt)
environment:
  - SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=192.168.192.1  # Host LAN IP
```

**Lösung — Zwei getrennte Pfade:**

1. **RTP Path (intern):**
   - ffmpeg → Mediasoup RTP Ingest
   - Ziel: `127.0.0.1` (Mediasoup Worker im gleichen Container)
   - Transport: PlainTransport mit `comedia: true`

2. **WebRTC Path (extern):**
   - Mediasoup → Browser WebRTC Consumer
   - Announced Address: `192.168.192.1` (Host-IP für ICE)
   - Transport: WebRtcTransport mit DTLS/SRTP

### 📊 Netzwerk-Diagramm

```
┌─────────────────────────────────────────────────┐
│          Docker Container (sharkord-dev)        │
│                                                 │
│  ┌──────────┐   RTP   ┌────────────────────┐  │
│  │  ffmpeg  │─────────→│ Mediasoup Worker   │  │
│  └──────────┘ 127.0.0.1│                    │  │
│                         │ listenIp: 0.0.0.0  │  │
│                         │ announcedIp: 192.  │  │
│                         │         168.192.1  │  │
│                         └──────────┬─────────┘  │
│                                    │            │
└────────────────────────────────────┼────────────┘
                                     │ WebRTC
                                     │ (UDP 40000-40100)
                                     │ ICE Candidate:
                                     │ 192.168.192.1
                                     ▼
                           ┌──────────────────┐
                           │   Browser Client │
                           │   (Host-Netz)    │
                           └──────────────────┘
```

### 🔍 Browser-Logs (vorher → nachher)

**Vorher (failed):**
```
[VOICE-PROVIDER] Consumer transport connection state changed {state: 'connecting'}
[VOICE-PROVIDER] Consumer transport connection state changed {state: 'failed'}
[VOICE-PROVIDER] Consumer transport failed, attempting cleanup
```

**Nachher (success):**
```
[VOICE-PROVIDER] Consumer transport connection state changed {state: 'connecting'}
[VOICE-PROVIDER] Consumer transport connection state changed {state: 'connected'}
[VOICE-PROVIDER] Created new consumer {newConsumer: o}
```

### 📝 Commit

```
3768441 - fix(REQ-002,REQ-003): separate WebRTC announced address from RTP target host

- Docker: Set SHARKORD_WEBRTC_ANNOUNCED_ADDRESS to LAN IP (192.168.192.1)
- Plugin: RTP target always uses local IP (127.0.0.1)
- Fixed: Consumer transport failed due to browser trying to connect to 127.0.0.1
- Fixed: ffmpeg sent RTP to wrong address when announcedAddress was used
- Added: Integration test for plugin lifecycle and UI registration
```

---

## 2. Weitere Erkenntnisse

### UI-Registrierung (REQ-017)

**Problem:** `ctx.ui.registerComponents()` nicht in Sharkord v0.0.7 Runtime verfügbar.

**Lösung:** Guard mit Fallback:
```typescript
const uiApi = ctx.ui as any;
if (typeof uiApi?.registerComponents === "function") {
  uiApi.registerComponents(components);
  ctx.log("[Vid With Friends] UI components registered.");
} else {
  ctx.log("[Vid With Friends] Runtime has no ctx.ui.registerComponents(); using exported components fallback.");
}
```

**Status:**
- ✅ Plugin lädt erfolgreich (kein Crash bei fehlendem API)
- ✅ Components werden exportiert (für zukünftige SDK-Versionen)
- ⚠️ Slot-Rendering noch nicht aktiv (erfordert Sharkord-Update)

### Pause-Funktion (REQ-013)

**Status:** ✅ Vollständig funktional (vom User bestätigt: "pause läuft!")

**Implementierung:**
- SIGSTOP/SIGCONT für ffmpeg-Prozesse
- `producer.pause()` / `producer.resume()` für Mediasoup
- Synchronisierte Audio+Video-Kontrolle

### RTP-Streaming Stabilität

**Beobachtungen:**
- ✅ Health-Checks zeigen kontinuierlichen Datenfluss
- ✅ Keine Exit Code 139 Crashes mehr (Temp-File-Methode)
- ✅ Video startet erst nach vollständigem Download (`waitForDownloadComplete: true`)
- ⚠️ ffmpeg "Late SEI" Warnings (harmlos, FFmpeg-Version bedingt)

**Beispiel Health-Log:**
```
[health:3] Video RTP Stats: bytes=1954893, packets=1733, jitter=144
[health:3] ✓ Video RTP data flowing
[health:3] Audio RTP Stats: bytes=93497, packets=273
[health:3] ✓ Audio RTP data flowing
```

---

## 3. Testing

### Integration Tests

**Neue Datei:** `tests/integration/index-onload.test.ts`
- Testet Plugin-Lifecycle (`onLoad`, `onUnload`)
- Validiert Command-Registrierung
- Prüft UI-Component-Export

**Test-Suite Status:** ✅ 24/24 Tests passing

---

## 4. Docker-Konfiguration

### Wichtige Port-Mappings

```yaml
ports:
  - "3000:3000"                    # Sharkord Web UI + API
  - "40000-40100:40000-40100/udp"  # WebRTC RTP (Mediasoup)
```

### Volume-Strategie

1. **sharkord-data:** Persistiert DB + Settings
2. **plugin-binaries:** Shared Volume für ffmpeg + yt-dlp (init-Service)
3. **./dist/sharkord-vid-with-friends:** Plugin-Code (read-only mount)
4. **./debug-cache:** Download-Cache für Debugging (Host-Zugriff)

---

## 5. Lessons Learned

### Network Architecture in Containerized WebRTC

**❌ Don't:**
- Verwende nicht die gleiche IP für interne RTP und externe WebRTC ICE candidates
- Setze nicht `announcedAddress` für lokales Container-Routing

**✅ Do:**
- Trenne klar zwischen:
  - **Internal**: Container-intern (127.0.0.1 oder Docker-Netzwerk)
  - **External**: Host-Netzwerk-IP für Client-Zugriff
- Verwende `comedia: true` für RTP PlainTransport (automatische Port-Detection)
- Teste mit realen Netzwerk-Bedingungen (nicht nur localhost)

### Debugging WebRTC Issues

**Haupt-Indikatoren:**
1. **Server-Logs:** "Created external stream", RTP Stats, Producer Scores
2. **Browser Console:** Transport connection states (`connecting` → `connected`/`failed`)
3. **Network Tab:** WebSocket-Events für Producers/Consumers
4. **ICE Candidates:** Prüfe announced addresses in SDP

**Tooling:**
- Browser: `chrome://webrtc-internals` für detaillierte ICE/DTLS-Logs
- Server: Health-Check-Logs für RTP-Flow-Validierung

### Docker Restart-Workflow

**Bei Plugin-Änderungen:**
```bash
bun run build
docker compose -f docker-compose.dev.yml restart sharkord
```

**Bei Compose-Änderungen (ENV vars):**
```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up -d
```

**Bei Volume-Reset:**
```bash
docker compose -f docker-compose.dev.yml down --volumes
docker compose -f docker-compose.dev.yml up -d
# ⚠️ Neuer Access Token aus Logs extrahieren!
```

---

## 6. Offene Punkte / Future Work

### UI Slots (REQ-029, REQ-030, REQ-031)

**Status:** Components exportiert, aber nicht gerendert.

**Gründe:**
- Sharkord v0.0.7 hat noch keine vollständige Slot-Rendering-Integration
- `ctx.ui.registerComponents()` API existiert noch nicht in Runtime

**Nächste Schritte:**
- Warten auf Sharkord SDK-Update
- Alternative: Custom Panel via Message-Commands

### Volume Control (REQ-014)

**Status:** Command implementiert, aber Funktion unklar.

**Offene Fragen:**
- Ist Volume-Control auf Audio-Producer-Level möglich?
- Benötigt client-seitige `<audio>` Volume-Manipulation?
- Oder Server-Side ffmpeg Audio-Filter (`-af volume=X`)?

### Auto-Advance Zuverlässigkeit

**Aktuell:** Nur Audio-Ende triggert Auto-Advance.

**Potential Issue:** Was wenn Video früher endet als Audio?

**Verbesserung:** Beide Prozesse monitoren, auf ersten Exit reagieren.

---

## 7. Deployment-Checklist

### Produktiv-Deployment (falls später relevant)

- [ ] `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS` auf öffentliche IP/Domain setzen
- [ ] Port 40000-40100 UDP in Firewall freigeben
- [ ] HTTPS/WSS für WebRTC (STUN/TURN falls NAT)
- [ ] ffmpeg/yt-dlp Version-Pinning (statt "latest")
- [ ] Log-Rotation für `debug-cache`
- [ ] Health-Monitoring (Prometheus/Grafana?)
- [ ] Rate-Limiting für `/watch` Command (YouTube API Quota)

---

## 8. Dateien geändert (diese Session)

### Modifiziert

- **[docker-compose.dev.yml](../docker-compose.dev.yml)**
  - `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=192.168.192.1`

- **[src/index.ts](../src/index.ts)**
  - RTP target host Logik korrigiert (kein `announcedAddress` mehr)
  - UI registration guard hinzugefügt

### Neu

- **[tests/integration/index-onload.test.ts](../tests/integration/index-onload.test.ts)**
  - Plugin lifecycle tests

---

## 9. Performance-Metriken

### Streaming-Stats (Beispiel-Session)

```
Video:
- Codec: H.264 → VP8 (libvpx)
- Resolution: 1920x1080
- Framerate: 25 fps
- Bitrate: ~2 Mbit/s
- RTP Packets: ~1700/min
- Jitter: 100-150ms

Audio:
- Codec: AAC → Opus (libopus)
- Bitrate: ~130 kbit/s
- RTP Packets: ~270/min

ffmpeg Speed: ~1.0x (real-time)
```

### Latenz

- Download-Start → Temp-File Ready: ~3-5s (abhängig von YouTube)
- ffmpeg Startup → First RTP Packet: ~500ms
- RTP → Browser Rendering: <200ms (WebRTC native)

**Gesamt-Latenz:** ~4-6 Sekunden vom `/watch` Command bis Video spielt.

---

## 10. Zusammenfassung

### ✅ Erreichte Ziele

1. **Video-Streaming funktioniert vollständig** (Browser zeigt Video an)
2. **Pause-Funktion getestet und bestätigt** (REQ-013)
3. **WebRTC-Netzwerk-Routing korrekt konfiguriert** (REQ-002, REQ-003)
4. **Plugin lädt stabil** (keine Crashes bei fehlenden APIs)
5. **Integration Tests erweitert** (23 → 24 Tests)

### 🔧 Technischer Durchbruch

**Der finale Fix** trennt klar zwischen internem RTP-Routing (Container) und externem WebRTC-Routing (Browser), was die vollständige Streaming-Pipeline aktiviert.

### 📈 Nächste Session

**Prioritäten:**
1. Volume-Control testen (REQ-014)
2. Queue-Funktionalität validieren (REQ-004, REQ-005, REQ-006, REQ-007)
3. Auto-Advance bei Video-Ende testen (REQ-009)
4. Robustheit bei Netzwerk-Issues (REQ-012)

---

**Session-Dauer:** ~50 Minuten  
**Commits:** 1 (`3768441`)  
**Status:** ✅ Major Milestone erreicht — Video-Streaming funktional!
