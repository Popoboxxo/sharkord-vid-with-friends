/**
 * Unit tests for StreamManager.
 *
 * TDD: Tests written BEFORE implementation.
 * Tests the Mediasoup transport/producer lifecycle management
 * using mock objects (no actual mediasoup/ffmpeg needed).
 *
 * Referenced by: REQ-002, REQ-003, REQ-015, REQ-016
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { StreamManager } from "../../src/stream/stream-manager";
import {
  createMockRouter,
  createMockPluginContext,
  type MockPluginContext,
  type MockTransport,
} from "../integration/mock-plugin-context";

describe("StreamManager", () => {
  let streamManager: StreamManager;
  let ctx: MockPluginContext;
  const channelId = 42;

  beforeEach(() => {
    ctx = createMockPluginContext();
    streamManager = new StreamManager();
  });

  // --- REQ-002: Transport + Producer creation ---

  it("[REQ-002] should create audio and video transports for a channel", async () => {
    const router = createMockRouter();
    const { ip } = ctx.actions.voice.getListenInfo();

    const resources = await streamManager.createTransports(router, ip, undefined);

    expect(resources.audioTransport).toBeTruthy();
    expect(resources.videoTransport).toBeTruthy();
    expect(resources.audioTransport.closed).toBe(false);
    expect(resources.videoTransport.closed).toBe(false);
  });

  it("[REQ-002] should create producers with correct codec params", async () => {
    const router = createMockRouter();
    const { ip } = ctx.actions.voice.getListenInfo();

    const resources = await streamManager.createTransports(router, ip, undefined);
    const producers = await streamManager.createProducers(resources);

    expect(producers.audioProducer).toBeTruthy();
    expect(producers.videoProducer).toBeTruthy();
    expect(producers.audioProducer.kind).toBe("audio");
    expect(producers.videoProducer.kind).toBe("video");
  });

  it("[REQ-002] should use provided H.264 profile-level-id", async () => {
    const router = createMockRouter();
    const { ip } = ctx.actions.voice.getListenInfo();

    const resources = await streamManager.createTransports(router, ip, undefined);
    await streamManager.createProducers(resources, "640028");

    const videoTransport = resources.videoTransport as MockTransport;
    const produceCall = (videoTransport.produceCalls[0] ?? {}) as {
      rtpParameters?: { codecs?: Array<{ parameters?: Record<string, unknown> }> };
    };
    const parameters = produceCall.rtpParameters?.codecs?.[0]?.parameters;
    const profileLevelId = parameters ? parameters["profile-level-id"] : undefined;

    expect(profileLevelId).toBe("640028");
  });

  // --- REQ-015: Track channel state ---

  it("[REQ-015] should track active state per channel", async () => {
    expect(streamManager.isActive(channelId)).toBe(false);

    streamManager.setActive(channelId, {
      audioTransport: createMockRouter() as unknown as ReturnType<typeof streamManager.createTransports> extends Promise<infer R> ? R["audioTransport"] : never,
    } as never);

    expect(streamManager.isActive(channelId)).toBe(true);
  });

  // --- REQ-016: Cleanup ---

  it("[REQ-016] should cleanup all resources for a channel", async () => {
    const router = createMockRouter();
    const { ip } = ctx.actions.voice.getListenInfo();

    const resources = await streamManager.createTransports(router, ip, undefined);
    const producers = await streamManager.createProducers(resources);

    streamManager.setActive(channelId, {
      ...resources,
      ...producers,
      videoProcess: null,
      audioProcess: null,
      streamHandle: null,
      router,
    });

    expect(streamManager.isActive(channelId)).toBe(true);

    streamManager.cleanup(channelId);

    expect(streamManager.isActive(channelId)).toBe(false);
    expect(resources.audioTransport.closed).toBe(true);
    expect(resources.videoTransport.closed).toBe(true);
    expect(producers.audioProducer.closed).toBe(true);
    expect(producers.videoProducer.closed).toBe(true);
  });

  it("[REQ-016] should handle cleanup of non-existent channel gracefully", () => {
    expect(() => streamManager.cleanup(999)).not.toThrow();
  });

  it("[REQ-016] should cleanup all channels at once", async () => {
    for (const chId of [1, 2, 3]) {
      const router = createMockRouter();
      const resources = await streamManager.createTransports(router, "127.0.0.1", undefined);
      const producers = await streamManager.createProducers(resources);
      streamManager.setActive(chId, {
        ...resources,
        ...producers,
        videoProcess: null,
        audioProcess: null,
        streamHandle: null,
        router,
      });
    }

    expect(streamManager.isActive(1)).toBe(true);
    expect(streamManager.isActive(2)).toBe(true);
    expect(streamManager.isActive(3)).toBe(true);

    streamManager.cleanupAll();

    expect(streamManager.isActive(1)).toBe(false);
    expect(streamManager.isActive(2)).toBe(false);
    expect(streamManager.isActive(3)).toBe(false);
  });

  // --- REQ-003: SSRC generation for sync ---

  it("[REQ-003] should generate unique SSRCs", () => {
    const ssrc1 = streamManager.generateSsrc();
    const ssrc2 = streamManager.generateSsrc();

    expect(ssrc1).toBeGreaterThan(0);
    expect(ssrc2).toBeGreaterThan(0);
    expect(ssrc1).not.toBe(ssrc2);
  });
});
