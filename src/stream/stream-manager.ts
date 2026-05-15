/**
 * StreamManager — manages Mediasoup transports, producers, and ffmpeg processes per channel.
 *
 * Handles the complete lifecycle: create transports → create producers → spawn ffmpeg → cleanup.
 *
 * Referenced by: REQ-002, REQ-003, REQ-015, REQ-016, REQ-044
 */
import type {
  TransportResources,
  ProducerResources,
  RouterLike,
} from "../types/stream";
import type { WatchdogOptions } from "./stream-watchdog";
import { AUDIO_CODEC, VIDEO_CODEC } from "../utils/constants";
import { unlinkSync, existsSync } from "fs";
import { StreamWatchdog } from "./stream-watchdog";
import { sweepOrphanedTempFiles } from "../utils/temp-cleanup";

export * from "../types/stream";
export { StreamWatchdog } from "./stream-watchdog";

// ---- StreamManager ----

export class StreamManager {
  private readonly activeStreams = new Map<number, ChannelStreamResources>();
  private readonly watchdog = new StreamWatchdog();

  /** Generate a random SSRC value for RTP. (REQ-003) */
  generateSsrc(): number {
    return Math.floor(Math.random() * 1_000_000_000) + 1;
  }

  /** Check if a channel has an active stream. */
  isActive(channelId: number): boolean {
    return this.activeStreams.has(channelId);
  }

  /** Register active stream resources for a channel. (REQ-015) */
  setActive(channelId: number, resources: ChannelStreamResources): void {
    this.activeStreams.set(channelId, resources);
  }

  /** Get active stream resources for a channel. */
  getResources(channelId: number): ChannelStreamResources | undefined {
    return this.activeStreams.get(channelId);
  }

  /** Pause active RTP stream for a channel (REQ-013). */
  pauseChannelStream(channelId: number): boolean {
    const resources = this.activeStreams.get(channelId);
    if (!resources) return false;
    try {
      resources.audioProducer.pause?.();
      resources.videoProducer.pause?.();
    } catch { /* ignore */ }
    return true;
  }

  /** Resume paused RTP stream for a channel (REQ-013). */
  resumeChannelStream(channelId: number): boolean {
    const resources = this.activeStreams.get(channelId);
    if (!resources) return false;
    try {
      resources.audioProducer.resume?.();
      resources.videoProducer.resume?.();
    } catch { /* ignore */ }
    return true;
  }

  /**
   * Create audio and video PlainTransports on a router. (REQ-002)
   */
  async createTransports(
    router: RouterLike,
    ip: string,
    announcedAddress: string | undefined
  ): Promise<TransportResources> {
    const transportOptions = {
      listenIp: { ip, announcedIp: announcedAddress },
      rtcpMux: true,
      comedia: true,
      enableSrtp: false,
    };

    const [audioTransport, videoTransport] = await Promise.all([
      router.createPlainTransport(transportOptions),
      router.createPlainTransport(transportOptions),
    ]);

    return {
      audioTransport,
      videoTransport,
      audioSsrc: this.generateSsrc(),
      videoSsrc: this.generateSsrc(),
    };
  }

  /**
   * Create audio and video producers on the transports. (REQ-002)
   */
  async createProducers(
    router: RouterLike,
    transports: TransportResources
  ): Promise<ProducerResources> {
    const { audioTransport, videoTransport, audioSsrc, videoSsrc } = transports;
    const audioPayloadType = this.getPayloadTypeFromRouter(router, AUDIO_CODEC.mimeType, AUDIO_CODEC.payloadType);
    const videoPayloadType = this.getPayloadTypeFromRouter(router, VIDEO_CODEC.mimeType, VIDEO_CODEC.payloadType);

    const [audioProducer, videoProducer] = await Promise.all([
      audioTransport.produce({
        kind: "audio",
        rtpParameters: {
          codecs: [
            {
              mimeType: AUDIO_CODEC.mimeType,
              payloadType: audioPayloadType,
              clockRate: AUDIO_CODEC.clockRate,
              channels: AUDIO_CODEC.channels,
              parameters: { minptime: 10, useinbandfec: 1 },
              rtcpFeedback: [],
            },
          ],
          encodings: [{ ssrc: audioSsrc }],
        },
      }),
      videoTransport.produce({
        kind: "video",
        rtpParameters: {
          codecs: [
            {
              mimeType: VIDEO_CODEC.mimeType,
              payloadType: videoPayloadType,
              clockRate: VIDEO_CODEC.clockRate,
              parameters: {
                "packetization-mode": 1,
                "level-asymmetry-allowed": 1,
                "profile-level-id": "42e01f",
              },
              rtcpFeedback: [
                { type: "nack" },
                { type: "nack", parameter: "pli" },
                { type: "ccm", parameter: "fir" },
              ],
            },
          ],
          encodings: [{ ssrc: videoSsrc }],
        },
      }),
    ]);

    return { audioProducer, videoProducer, audioPayloadType, videoPayloadType };
  }

  private getPayloadTypeFromRouter(router: RouterLike, mimeType: string, fallback: number): number {
    const codecs = router.rtpCapabilities?.codecs ?? [];
    const match = codecs.find((codec) => codec.mimeType?.toLowerCase() === mimeType.toLowerCase());
    return match?.preferredPayloadType ?? fallback;
  }

  /**
   * Cleanup all resources for a channel. (REQ-016, REQ-037)
   */
  cleanup(channelId: number): void {
    this.watchdog.stop(channelId);

    const resources = this.activeStreams.get(channelId);
    if (resources) {
      resources.videoProcess?.kill();
      resources.audioProcess?.kill();

      try { resources.streamHandle?.remove(); } catch { /* */ }
      try { resources.audioProducer?.close(); } catch { /* */ }
      try { resources.videoProducer?.close(); } catch { /* */ }
      try { resources.audioTransport?.close(); } catch { /* */ }
      try { resources.videoTransport?.close(); } catch { /* */ }

      if (resources.videoTempFile && existsSync(resources.videoTempFile)) {
        try { unlinkSync(resources.videoTempFile); } catch { /* */ }
      }
      if (resources.audioTempFile && existsSync(resources.audioTempFile)) {
        try { unlinkSync(resources.audioTempFile); } catch { /* */ }
      }

      this.activeStreams.delete(channelId);
    }
  }

  /**
   * Cleanup all channels at once. (REQ-016)
   */
  cleanupAll(): void {
    for (const channelId of this.activeStreams.keys()) {
      this.cleanup(channelId);
    }
    sweepOrphanedTempFiles();
  }

  // ---- Watchdog delegation ----

  startWatchdog(channelId: number, options: ConstructorParameters<typeof StreamWatchdog>[0] extends undefined ? import("./stream-watchdog").WatchdogOptions : import("./stream-watchdog").WatchdogOptions): void {
    this.watchdog.start(channelId, (id) => this.getResources(id), options);
  }

  stopWatchdog(channelId: number): void {
    this.watchdog.stop(channelId);
  }
}
