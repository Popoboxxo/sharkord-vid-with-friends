/**
 * Voice action compatibility layer.
 *
 * TODO(SDK-upgrade): Remove after SDK >= 0.1.0 — ctx.actions.voice deprecated in 0.0.16
 */
import type { StreamHandleLike } from "../stream/stream-manager";

export type VoiceActions = {
  getRouter: (channelId: number) => unknown;
  getListenInfo: () => Promise<{ ip: string; announcedAddress?: string }>;
  createStream: (options: {
    channelId: number;
    key: string;
    title: string;
    avatarUrl?: string;
    producers: { audio: unknown; video: unknown };
  }) => StreamHandleLike;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getFunction = <T extends (...args: never[]) => unknown>(
  source: Record<string, unknown>,
  names: string[]
): T | null => {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "function") {
      return value as T;
    }
  }
  return null;
};

type MinimalPluginContext = {
  actions?: {
    voice?: Record<string, unknown>;
  } & Record<string, unknown>;
  voice?: Record<string, unknown>;
} & Record<string, unknown>;

export const resolveVoiceActions = (ctx: MinimalPluginContext): VoiceActions => {
  const candidates: Record<string, unknown>[] = [];

  if (isObjectRecord(ctx.actions) && isObjectRecord(ctx.actions.voice)) {
    candidates.push(ctx.actions.voice);
  }

  if (isObjectRecord(ctx.actions)) {
    candidates.push(ctx.actions);
  }

  if (isObjectRecord(ctx["voice"])) {
    candidates.push(ctx["voice"] as Record<string, unknown>);
  }

  for (const candidate of candidates) {
    const getRouter = getFunction<(channelId: number) => unknown>(candidate, [
      "getRouter",
      "getVoiceRouter",
      "getMediasoupRouter",
    ]);
    const getListenInfo = getFunction<() => Promise<{ ip: string; announcedAddress?: string }>>(candidate, [
      "getListenInfo",
      "getWebRtcListenInfo",
      "getRtpListenInfo",
    ]);
    const createStream = getFunction<(options: {
      channelId: number;
      key: string;
      title: string;
      avatarUrl?: string;
      producers: { audio: unknown; video: unknown };
    }) => StreamHandleLike>(candidate, [
      "createStream",
      "addExternalStream",
    ]);

    if (getRouter && getListenInfo && createStream) {
      return { getRouter, getListenInfo, createStream };
    }
  }

  const actionKeys = isObjectRecord(ctx.actions) ? Object.keys(ctx.actions).join(", ") : "none";
  const voiceKeys = isObjectRecord(ctx.actions) && isObjectRecord(ctx.actions.voice)
    ? Object.keys(ctx.actions.voice).join(", ")
    : "none";

  throw new Error(
    `Voice actions unavailable: expected getRouter/getListenInfo/createStream. actions=[${actionKeys}] actions.voice=[${voiceKeys}]`
  );
};
