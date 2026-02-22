/**
 * StreamManager — manages Mediasoup transports, producers, and ffmpeg processes per channel.
 *
 * Handles the complete lifecycle: create transports → create producers → spawn ffmpeg → cleanup.
 *
 * Referenced by: REQ-002, REQ-003, REQ-015, REQ-016
 */
import type { SpawnedProcess } from "./ffmpeg";
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
};

// ---- StreamManager ----

export class StreamManager {
  private readonly activeStreams = new Map<number, ChannelStreamResources>();

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
    transports: TransportResources
  ): Promise<ProducerResources> {
    const { audioTransport, videoTransport, audioSsrc, videoSsrc } = transports;

    const [audioProducer, videoProducer] = await Promise.all([
      audioTransport.produce({
        kind: "audio",
        rtpParameters: {
          codecs: [
            {
              mimeType: AUDIO_CODEC.mimeType,
              payloadType: AUDIO_CODEC.payloadType,
              clockRate: AUDIO_CODEC.clockRate,
              channels: AUDIO_CODEC.channels,
              parameters: {},
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
              payloadType: VIDEO_CODEC.payloadType,
              clockRate: VIDEO_CODEC.clockRate,
              parameters: {
                "packetization-mode": 1,
                "profile-level-id": "42e01f",
              },
              rtcpFeedback: [],
            },
          ],
          encodings: [{ ssrc: videoSsrc }],
        },
      }),
    ]);

    return { audioProducer, videoProducer };
  }

  /**
   * Cleanup all resources for a channel. (REQ-016)
   * Closes transports, producers, kills processes, removes stream handle.
   */
  cleanup(channelId: number): void {
    const resources = this.activeStreams.get(channelId);
    if (!resources) return;

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

  /**
   * Cleanup all channels at once. (REQ-016)
   * Used during plugin unload.
   */
  cleanupAll(): void {
    for (const channelId of this.activeStreams.keys()) {
      this.cleanup(channelId);
    }
  }
}
