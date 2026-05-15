/**
 * Shared stream-related types.
 */
import type { SpawnedProcess } from "../stream/ffmpeg";

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
  videoTempFile?: string;
  audioTempFile?: string;
  debugEnabled?: boolean;
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
