/**
 * StreamManager — manages Mediasoup transports, producers, and ffmpeg processes per channel.
 *
 * Handles the complete lifecycle: create transports → create producers → spawn ffmpeg → cleanup.
 *
 * Referenced by: REQ-002, REQ-003, REQ-015, REQ-016
 */
import type { SpawnedProcess } from "./ffmpeg";
import type { HLSServerHandle } from "./hls-server";
import { AUDIO_CODEC, VIDEO_CODEC } from "../utils/constants";

// ---- Types ----

/** Minimal Transport interface (compatible with both real Mediasoup and mocks) */
export type TransportLike = {
  id: string;
  closed: boolean;
  tuple: { localPort: number };
  close: () => void;
  produce: (options: unknown) => Promise<ProducerLike>;
};

/** Minimal Producer interface */
export type ProducerLike = {
  id: string;
  kind: "audio" | "video";
  closed: boolean;
  close: () => void;
  pause?: () => void;
  resume?: () => void;
  observer: {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
};

/** Minimal Router interface */
export type RouterLike = {
  id: string;
  closed: boolean;
  close: () => void;
  createPlainTransport: (options: unknown) => Promise<TransportLike>;
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
  rtpCapabilities?: {
    codecs?: Array<{
      mimeType?: string;
      preferredPayloadType?: number;
      clockRate?: number;
      channels?: number;
      parameters?: Record<string, unknown>;
    }>;
  };
};

/** External stream handle returned by createStream */
export type StreamHandleLike = {
  streamId: number;
  remove: () => void;
  update: (options: unknown) => void;
};

/** All resources associated with an active stream in a channel */
export type ChannelStreamResources = {
  audioTransport: TransportLike;
  videoTransport: TransportLike;
  audioProducer: ProducerLike;
  videoProducer: ProducerLike;
  videoProcess: SpawnedProcess | null;
  audioProcess: SpawnedProcess | null;
  streamHandle: StreamHandleLike | null;
  router: RouterLike;
};

/** HLS-specific stream resources (alternative to RTP/Mediasoup) */
export type HLSChannelStreamResources = {
  hlsServer: HLSServerHandle;
  ffmpegProcess: ReturnType<typeof Bun.spawn>;
  ffmpegKill: () => void;
  streamHandle?: StreamHandleLike;  // Optional: registered with Sharkord
};

/** Transports only (before producers are created) */
export type TransportResources = {
  audioTransport: TransportLike;
  videoTransport: TransportLike;
  audioSsrc: number;
  videoSsrc: number;
};

/** Producers only */
export type ProducerResources = {
  audioProducer: ProducerLike;
  videoProducer: ProducerLike;
  audioPayloadType: number;
  videoPayloadType: number;
};

// ---- StreamManager ----

export class StreamManager {
  private readonly activeStreams = new Map<number, ChannelStreamResources>();
  private readonly activeHLSStreams = new Map<number, HLSChannelStreamResources>();

  /** Generate a random SSRC value for RTP. (REQ-003) */
  generateSsrc(): number {
    return Math.floor(Math.random() * 1_000_000_000) + 1;
  }

  /** Check if a channel has an active stream. */
  isActive(channelId: number): boolean {
    return this.activeStreams.has(channelId) || this.activeHLSStreams.has(channelId);
  }

  /** Register active stream resources for a channel. (REQ-015) */
  setActive(channelId: number, resources: ChannelStreamResources): void {
    this.activeStreams.set(channelId, resources);
  }

  /** Register active HLS stream resources for a channel. */
  setActiveHLS(channelId: number, resources: HLSChannelStreamResources): void {
    this.activeHLSStreams.set(channelId, resources);
  }

  /** Get active stream resources for a channel. */
  getResources(channelId: number): ChannelStreamResources | undefined {
    return this.activeStreams.get(channelId);
  }

  /** Get active HLS stream resources for a channel. */
  getHLSResources(channelId: number): HLSChannelStreamResources | undefined {
    return this.activeHLSStreams.get(channelId);
  }

  /** Pause active RTP stream for a channel (REQ-013).
   * 
   * Mediasoup approach: Pause producers, which signals WebRTC consumers to mute
   * the stream. The ffmpeg processes continue running to avoid restart delays
   * when resuming (they just accumulate packets that won't be sent).
   * 
   * NOTE: SIGSTOP/SIGCONT only work on Unix. On Windows, process suspension
   * via signals is not reliable. Producer pause is the primary control mechanism.
   */
  pauseChannelStream(channelId: number): boolean {
    const resources = this.activeStreams.get(channelId);
    if (!resources) return false;

    try {
      // Pause producers - signals WebRTC consumers to mute
      resources.audioProducer.pause?.();
      resources.videoProducer.pause?.();
    } catch {
      // ignore producer pause failures (API may not support pause)
    }

    // Note: ffmpeg processes continue running but produce muted streams
    // This avoids expensive restart overhead on resume

    return true;
  }

  /** Resume paused RTP stream for a channel (REQ-013).
   * 
   * Restores producers so WebRTC consumers receive packets again.
   * ffmpeg processes were never actually paused, so no restart needed.
   */
  resumeChannelStream(channelId: number): boolean {
    const resources = this.activeStreams.get(channelId);
    if (!resources) return false;

    try {
      resources.audioProducer.resume?.();
      resources.videoProducer.resume?.();
    } catch {
      // ignore producer resume failures (API may not support resume)
    }

    return true;
  }

  /**
   * Create audio and video PlainTransports on a router. (REQ-002)
   * Returns transports and generated SSRCs.
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
    // H264 codec configuration for RTP streaming via Mediasoup (REQ-002).
    const audioPayloadType = this.getPayloadTypeFromRouter(
      router,
      AUDIO_CODEC.mimeType,
      AUDIO_CODEC.payloadType
    );
    const videoPayloadType = this.getPayloadTypeFromRouter(
      router,
      VIDEO_CODEC.mimeType,
      VIDEO_CODEC.payloadType
    );

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
              parameters: {
                "minptime": 10,
                "useinbandfec": 1,
              },
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

  private getPayloadTypeFromRouter(
    router: RouterLike,
    mimeType: string,
    fallback: number
  ): number {
    const codecs = router.rtpCapabilities?.codecs ?? [];
    const match = codecs.find(
      (codec) => codec.mimeType?.toLowerCase() === mimeType.toLowerCase()
    );

    if (match?.preferredPayloadType === undefined) return fallback;
    return match.preferredPayloadType;
  }

  /**
   * Cleanup all resources for a channel. (REQ-016)
   * Closes transports, producers, kills processes, removes stream handle.
   */
  cleanup(channelId: number): void {
    const resources = this.activeStreams.get(channelId);
    if (resources) {
      // Kill ffmpeg processes
      resources.videoProcess?.kill();
      resources.audioProcess?.kill();

      // Remove stream from Sharkord
      try {
        resources.streamHandle?.remove();
      } catch {
        // Ignore errors during cleanup
      }

      // Close producers
      try {
        resources.audioProducer?.close();
      } catch {
        // Ignore
      }
      try {
        resources.videoProducer?.close();
      } catch {
        // Ignore
      }

      // Close transports
      try {
        resources.audioTransport?.close();
      } catch {
        // Ignore
      }
      try {
        resources.videoTransport?.close();
      } catch {
        // Ignore
      }

      this.activeStreams.delete(channelId);
    }

    // Cleanup HLS resources
    const hlsResources = this.activeHLSStreams.get(channelId);
    if (hlsResources) {
      // Remove stream from Sharkord
      try {
        hlsResources.streamHandle?.remove();
      } catch {
        // Ignore
      }

      // Kill ffmpeg process
      try {
        hlsResources.ffmpegKill();
      } catch {
        // Ignore
      }

      // Close HLS server
      try {
        hlsResources.hlsServer.close().catch(() => {
          // Ignore errors during close
        });
      } catch {
        // Ignore
      }

      this.activeHLSStreams.delete(channelId);
    }
  }

  /**
   * Cleanup all channels at once. (REQ-016)
   * Used during plugin unload.
   */
  cleanupAll(): void {
    for (const channelId of this.activeStreams.keys()) {
      this.cleanup(channelId);
    }
    for (const channelId of this.activeHLSStreams.keys()) {
      this.cleanup(channelId);
    }
  }
}
