/**
 * Native Sharkord v0.0.22 client entry — sharkord-vid-with-friends.
 *
 * Exports `components` (slot → React component[]). Rendered by the host with NO
 * props; live state comes from the server via callAction("vid:state") and
 * controls call callAction("vid:control", { op }). Uses the shared Sharkord
 * Plugin UI-Kit (teal brand) for a uniform look & feel across all plugins.
 */

import { useEffect, useState } from "react";
import { Badge, Button, Card, IconButton, Panel, List, StatusDot, tokens } from "../ui/kit";
import { callAction, getStore } from "../ui/kit/store";

const ICON = "🎬";

type PlaybackState = {
  nowPlaying: { title: string; duration: number } | null;
  isPaused: boolean;
  volume: number;
  queueCount: number;
  upcoming: string[];
};

const EMPTY: PlaybackState = { nowPlaying: null, isPaused: false, volume: 100, queueCount: 0, upcoming: [] };

/** Poll vid:state on an interval; refresh() lets controls update immediately. */
function usePlayback(pollMs = 3000): [PlaybackState, () => void] {
  const [state, setState] = useState<PlaybackState>(EMPTY);
  const refresh = () => {
    void callAction<PlaybackState>("vid:state").then((s) => {
      if (s) setState({ ...EMPTY, ...s });
    });
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [state, refresh];
}

async function control(op: "pause" | "resume" | "skip" | "stop", after: () => void) {
  await callAction("vid:control", { op });
  after();
}

/** TOPBAR_RIGHT — live now-playing + inline controls. */
function NowPlayingBadge() {
  const [s, refresh] = usePlayback();
  const label = s.nowPlaying ? s.nowPlaying.title : "Idle";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: tokens.gap }}>
      <Badge icon={ICON} tone={s.nowPlaying ? "accent" : "muted"}>
        {label}
      </Badge>
      {s.nowPlaying && (
        <>
          <IconButton icon={s.isPaused ? "▶" : "⏸"} title={s.isPaused ? "Resume" : "Pause"} onClick={() => control(s.isPaused ? "resume" : "pause", refresh)} />
          <IconButton icon="⏭" title="Skip" onClick={() => control("skip", refresh)} />
        </>
      )}
    </div>
  );
}

/** HOME_SCREEN — queue overview card. */
function QueueCard() {
  const [s] = usePlayback(5000);
  return (
    <Card title="Vid With Friends" icon={ICON}>
      {s.nowPlaying ? (
        <div style={{ fontSize: tokens.fontMd }}>
          <div style={{ display: "flex", alignItems: "center", gap: tokens.gap }}>
            <StatusDot color={tokens.accent} pulse />
            <strong>{s.nowPlaying.title}</strong>
          </div>
          <p style={{ margin: "6px 0 0 0", fontSize: tokens.fontSm, color: tokens.textMuted }}>
            {s.queueCount > 1 ? `${s.queueCount - 1} more in queue` : "Nothing queued"}
          </p>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: tokens.fontSm, color: tokens.textMuted }}>
          Join a voice channel and use <code>/vid-watch</code> to start watching together.
        </p>
      )}
    </Card>
  );
}

/** CHAT_ACTIONS — quick watch entry point. */
function WatchButton() {
  return (
    <IconButton
      icon={ICON}
      title="Watch a YouTube video together (/vid-watch <url>)"
      onClick={() => {
        const url = typeof window !== "undefined" ? window.prompt("YouTube URL or search query:") : null;
        const store = getStore();
        const channelId = store?.getState().selectedChannelId;
        if (url && store && channelId != null) {
          void store.actions.sendMessage(channelId, `/vid-watch ${url}`);
        }
      }}
    />
  );
}

/** FULL_SCREEN — queue manager. */
function QueueManager() {
  const [s, refresh] = usePlayback(4000);
  return (
    <Panel title="Vid With Friends — Queue" icon={ICON}>
      <Card title={s.nowPlaying ? "Now Playing" : "Idle"}>
        {s.nowPlaying ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: tokens.gap }}>
              <StatusDot color={tokens.accent} pulse />
              {s.nowPlaying.title}
            </span>
            <span style={{ display: "flex", gap: "8px" }}>
              <Button variant="ghost" onClick={() => control(s.isPaused ? "resume" : "pause", refresh)}>
                {s.isPaused ? "Resume" : "Pause"}
              </Button>
              <Button variant="ghost" onClick={() => control("skip", refresh)}>Skip</Button>
              <Button variant="danger" onClick={() => control("stop", refresh)}>Stop</Button>
            </span>
          </div>
        ) : (
          <span style={{ color: tokens.textMuted }}>Nothing playing. Use /vid-watch to start.</span>
        )}
      </Card>
      <Card title={`Up Next (${Math.max(0, s.queueCount - 1)})`}>
        <List items={s.upcoming.map((t) => <span>{t}</span>)} empty="Queue is empty." />
      </Card>
    </Panel>
  );
}

export const components = {
  topbar_right: [NowPlayingBadge],
  home_screen: [QueueCard],
  chat_actions: [WatchButton],
  full_screen: [QueueManager],
};
