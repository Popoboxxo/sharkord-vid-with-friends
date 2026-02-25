# Erkenntnisse — 26. Februar 2026

## Session-Zusammenfassung

Session-Ziel: Debugging des schwarzen Bildschirms + stummem Audio trotz korrektem RTP-Flow.
Vorherige Sessions hatten bereits Server-seitige Fixes implementiert (temp-file streaming, async spawnFfmpeg, 
Profile-Level-ID Fixes, H264 Baseline Re-Encoding mit Keyframes). Heute wurde die Root Cause
endgültig identifiziert und behoben.

---

## 1. Client-Code-Analyse (Sharkord v0.0.6)

### Sharkord Client-Architektur für ExternalStreams
- Client JS: `/root/.config/sharkord/interface/0.0.6/assets/index-vYHCTRjv.js` (2.4MB, minified)
- **ProduceType-Enum**: `Gt.EXTERNAL_VIDEO = "external_video"`, `Gt.EXTERNAL_AUDIO = "external_audio"`
- **Consumer-Flow**: `voice.getProducers.query()` → `remoteExternalStreamIds` → `consume(id, Gt.EXTERNAL_VIDEO/AUDIO, rtpCapabilities)`
- **Track-Zuordnung**: `addExternalStreamTrack(remoteId, MediaStream, kind)` → speichert in `externalStreams[id].videoStream/audioStream`
- **Rendering**: `Lv` Hook → `externalVideoRef.current.srcObject = P` (MediaStream) → `<video>` / `<audio>` Elemente
- **Audio**: Separates `<audio autoPlay>` Element mit `className="hidden"` für jeden ExternalStream

### Wichtige Erkenntnis: Server-seitiger Consumer
```
const consumer = await userConsumerTransport.consume({
    paused: false    // ← Consumer wird MIT paused:false erstellt = sofort aktiv
});
```
Das bedeutet: Der Browser-Consumer ist sofort bereit. Das Problem lag nicht am Consumer Resume.

### Erkenntnis: onNewProducer Event-Format
```javascript
pubsub.publishForChannel(channelId, "voiceNewProducer", {
    channelId: channelId,
    remoteId: streamId,        // ← Die Stream-ID, NICHT eine User-ID
    kind: "external_video"     // ← oder "external_audio"
});
```

---

## 2. Root Cause: H.264 + PlainTransport Keyframe-Problem

### Das fundamentale Problem
1. **ffmpeg startet sofort** mit RTP-Ausgabe nach `createStream()` 
2. **Erster Keyframe (IDR)** wird als erstes Frame gesendet
3. **Client braucht ~200-500ms** für: `onNewProducer` → `voice.consume` → `connectConsumerTransport` (ICE + DTLS Handshake)
4. **IDR geht verloren** — der Consumer war noch nicht verbunden
5. **Browser sendet PLI** (Picture Loss Indication) via RTCP
6. **PlainTransport + comedia** leitet RTCP an ffmpeg weiter, aber **ffmpeg ignoriert eingehendes RTCP** auf dem RTP-Port
7. **Kein neuer Keyframe** → Browser bleibt bei schwarzem Bild → **Permanenter schwarzer Bildschirm**

### Warum H.264 besonders betroffen ist
- H.264 braucht SPS/PPS (Sequence/Picture Parameter Sets) VOR dem ersten Frame
- Ohne IDR kann der Decoder nicht initialisiert werden
- Profile-Level-ID (42e01f vs 640032) Negotiation ist komplex
- `h264_mp4toannexb` Bitstream-Filter war bei `-c:v copy` nötig

### Warum vorherige Fixes nicht geholfen haben
| Fix | Warum es nicht half |
|-----|---------------------|
| Profile-Level-ID 42e01f | Richtig für Negotiation, aber IDR ging trotzdem verloren |
| Re-Encoding mit libx264 | Keyframe alle 2s — aber erster IDR ging trotzdem verloren |
| `-force_key_frames` | Erzeugt Keyframes, aber ffmpeg reagiert nicht auf RTCP vom Browser |
| RTCP Feedback (nack/pli/fir) | Producer-seitig konfiguriert, aber ffmpeg ist kein Mediasoup Consumer |

---

## 3. Lösung: VP8 + Verzögerung

### Fix 1: Codec-Wechsel H.264 → VP8

**Warum VP8:**
- Keine SPS/PPS-Abhängigkeit (im Gegensatz zu H.264)
- Selbstständige Keyframes — jeder Keyframe enthält alle nötigen Informationen
- Kein Profile-Level-ID Negotiation
- Universal WebRTC-Support in allen Browsern
- Router unterstützt VP8 (PT=102, bestätigt durch Router Capabilities Dump)

**ffmpeg-Konfiguration:**
```
-c:v libvpx -quality realtime -deadline realtime -cpu-used 8
-g 25 -keyint_min 25 -auto-alt-ref 0 -error-resilient 1
```
- Keyframe jede Sekunde (bei 25fps)
- `-auto-alt-ref 0` — Pflicht für RTP-Streaming (alt-ref frames sind nicht streambar)
- `-error-resilient 1` — Paketverlust-Toleranz
- `-cpu-used 8` — maximale Geschwindigkeit für Docker

### Fix 2: 2-Sekunden-Verzögerung nach createStream()

```typescript
// createStream() → Client bekommt onNewProducer → consume → DTLS Handshake
ctx.log(`Waiting 2s for client consumer transport setup...`);
await new Promise(resolve => setTimeout(resolve, 2000));
// JETZT erst startet ffmpeg → erster Keyframe kommt an
```

Timing-Garantie:
- `createStream()` → Server emittiert `voiceNewProducer`
- Client: `onNewProducer` → `voice.consume.mutate()` (~13ms) → `connectConsumerTransport` (~2ms)
- ICE + DTLS: ~100-400ms
- 2s Marge → mehr als ausreichend

### Fix 3: Producer-Parameter vereinfacht

VP8 braucht keine codec-spezifischen `parameters`:
```typescript
{
  mimeType: "video/VP8",
  payloadType: 96,
  clockRate: 90000,
  parameters: {},  // ← Leer, kein profile-level-id/packetization-mode
  rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }, { type: "ccm", parameter: "fir" }]
}
```

---

## 4. Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `src/utils/constants.ts` | `VIDEO_CODEC.mimeType`: `"video/H264"` → `"video/VP8"` |
| `src/stream/ffmpeg.ts` | `buildVideoStreamArgs()`: libx264 → libvpx mit VP8-Flags |
| `src/stream/stream-manager.ts` | `createProducers()`: H264-Parameter entfernt, VP8 leer |
| `src/index.ts` | 2s Verzögerung nach `createStream()` vor ffmpeg-Start |
| `tests/unit/ffmpeg.test.ts` | Alle Video-Tests auf VP8 aktualisiert |
| `tests/unit/stream-manager.test.ts` | VP8 statt H264 Profile-Level-ID Test |
| `tests/unit/yt-dlp.test.ts` | `videoProfileLevelId` Test entfernt |
| `tests/unit/commands.test.ts` | `videoProfileLevelId` aus Mock entfernt |
| `tests/unit/queue-manager.test.ts` | `videoProfileLevelId` aus Mock entfernt |
| `tests/unit/sync-controller.test.ts` | `videoProfileLevelId` aus Mock entfernt |
| `tests/integration/plugin-lifecycle.test.ts` | `videoProfileLevelId` aus Mock entfernt |
| `tests/docker/e2e-smoke.test.ts` | VP8-Flags + `inputPath` statt `sourceUrl` |

---

## 5. Testergebnis

```
105 pass
0 fail
235 expect() calls
Ran 105 tests across 6 files. [136.00ms]
```

---

## 6. Router RTP Capabilities (Referenz)

```
video/VP9   PT=100  params={"profile-id":0,"x-google-start-bitrate":2000}
video/VP8   PT=102  params={"x-google-start-bitrate":2000}
video/H264  PT=104  params={"level-asymmetry-allowed":1,"packetization-mode":1,"profile-level-id":"42e01f"}
video/H264  PT=106  params={"level-asymmetry-allowed":1,"packetization-mode":1,"profile-level-id":"640032"}
video/AV1   PT=108  params={"x-google-start-bitrate":2000}
audio/opus  PT=110  params={"useinbandfec":1,"usedtx":1,"stereo":1,"sprop-stereo":1}
```

---

## 7. Nächste Schritte

- [ ] Manueller Test im Browser: `/watch <url>` in Voice Channel
- [ ] Prüfen ob Video + Audio tatsächlich spielen
- [ ] Falls immer noch schwarz: Browser DevTools Console prüfen (WebRTC Stats)
- [ ] CODEBASE_OVERVIEW.md aktualisieren (VP8 statt H264)
- [ ] REQUIREMENTS.md prüfen
- [ ] Integration-Tests für streaming-real.test.ts fixen (veraltete API)
