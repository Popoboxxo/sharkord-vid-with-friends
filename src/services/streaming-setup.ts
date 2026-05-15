/**
 * Mediasoup transport and producer setup for a stream.
 */
import type { PluginContext } from "../utils/settings";

export async function createMediasoupProducers(
  ctx: PluginContext,
  channelId: number,
  router: unknown,
  ip: string,
  announcedAddress: string | undefined
): Promise<{
  audioTransport: unknown;
  videoTransport: unknown;
  audioProducer: unknown;
  videoProducer: unknown;
  rtpTargetHost: string;
}> {
  const transportOptions = {
    listenIp: { ip, announcedIp: announcedAddress },
    rtcpMux: true,
    comedia: true,
    enableSrtp: false,
  };

  ctx.debug(`[stream:${channelId}] Creating Mediasoup transports on ${ip}...`);

  const audioTransport = await (router as any).createPlainTransport(transportOptions);
  const videoTransport = await (router as any).createPlainTransport(transportOptions);

  ctx.log(`[stream:${channelId}] Audio transport created (port ${audioTransport.tuple?.localPort})`);
  ctx.log(`[stream:${channelId}] Video transport created (port ${videoTransport.tuple?.localPort})`);

  const audioProducer = await audioTransport.produce({
    kind: "audio",
    rtpParameters: {
      codecs: [
        {
          mimeType: "audio/opus",
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: {
            minptime: 10,
            useinbandfec: 1,
          },
          rtcpFeedback: [],
        },
      ],
      encodings: [{ ssrc: Math.floor(Math.random() * 1_000_000_000) + 1 }],
    },
  });

  const videoProducer = await videoTransport.produce({
    kind: "video",
    rtpParameters: {
      codecs: [
        {
          mimeType: "video/H264",
          payloadType: 96,
          clockRate: 90000,
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
      encodings: [{ ssrc: Math.floor(Math.random() * 1_000_000_000) + 1 }],
    },
  });

  ctx.log(`[stream:${channelId}] Audio producer created (SSRC: ${audioProducer.rtpParameters?.encodings?.[0]?.ssrc})`);
  ctx.log(`[stream:${channelId}] Video producer created (SSRC: ${videoProducer.rtpParameters?.encodings?.[0]?.ssrc})`);

  const rtpTargetHost = ip === "0.0.0.0" ? "127.0.0.1" : ip;

  return { audioTransport, videoTransport, audioProducer, videoProducer, rtpTargetHost };
}
