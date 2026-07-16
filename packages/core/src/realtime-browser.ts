import type { FetchLike } from "./types.ts";
import {
  createChatGPTRealtimeAction,
  encodeChatGPTRealtimeEvent,
  getChatGPTRealtimePayload,
  parseChatGPTRealtimeEvent,
  type ChatGPTRealtimeAction,
  type ChatGPTRealtimeEvent,
  type ChatGPTRealtimeSessionOptions,
  type ChatGPTRealtimeState,
} from "./realtime.ts";

export interface ChatGPTRealtimeBargeInOptions {
  /** Input RMS needed to interrupt model speech. Defaults to `0.045`. */
  threshold?: number;
  /** Speech must remain above the threshold for this long. Defaults to 120ms. */
  holdMs?: number;
  /** Minimum interval between interrupts. Defaults to 800ms. */
  cooldownMs?: number;
}

export interface ConnectChatGPTRealtimeOptions {
  /** Cookie-authenticated SDK route. Defaults to `/api/chatgpt/realtime`. */
  endpoint?: string;
  session?: ChatGPTRealtimeSessionOptions;
  fetch?: FetchLike;
  /** Reuse an existing stream instead of asking for microphone/camera access. */
  mediaStream?: MediaStream;
  mediaConstraints?: MediaStreamConstraints;
  peerConnection?: RTCPeerConnection;
  audioElement?: HTMLAudioElement;
  /** Add the send-only video m-line expected by ChatGPT. Defaults to true. */
  addVideoTransceiver?: boolean;
  /** Local voice-activity barge-in. Enabled by default; set false to disable. */
  bargeIn?: boolean | ChatGPTRealtimeBargeInOptions;
  iceGatheringTimeoutMs?: number;
  connectionTimeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: ChatGPTRealtimeEvent) => void;
  onStateChange?: (state: ChatGPTRealtimeState) => void;
  onError?: (error: Error) => void;
}

export interface ChatGPTRealtimeConnection {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  mediaStream: MediaStream;
  audioElement: HTMLAudioElement;
  get state(): ChatGPTRealtimeState;
  send(event: ChatGPTRealtimeEvent): void;
  action(action: ChatGPTRealtimeAction | string, payload?: Record<string, unknown>): void;
  startListening(): void;
  stopListening(): void;
  stopSpeaking(): void;
  resumeListening(): void;
  relayMessage(payload: Record<string, unknown>): void;
  setInputMuted(muted: boolean): void;
  setOutputMuted(muted: boolean): void;
  close(): void;
}

/**
 * Opens a browser WebRTC session without exposing ChatGPT credentials. The SDP
 * offer goes to the SDK's cookie-authenticated server route; media then flows
 * directly over WebRTC.
 */
export async function connectChatGPTRealtime(
  options: ConnectChatGPTRealtimeOptions = {},
): Promise<ChatGPTRealtimeConnection> {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new TypeError("No fetch implementation available.");
  if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices) {
    throw new TypeError("connectChatGPTRealtime() requires browser WebRTC and media APIs.");
  }

  const ownsStream = !options.mediaStream;
  const stream = options.mediaStream ?? await navigator.mediaDevices.getUserMedia(
    options.mediaConstraints ?? {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    },
  );
  const peer = options.peerConnection ?? new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  const channel = peer.createDataChannel("", { negotiated: true, id: 0 });
  const audio = options.audioElement ?? document.createElement("audio");
  audio.autoplay = true;

  let state: ChatGPTRealtimeState = "connecting";
  let closed = false;
  let outputMuted = audio.muted;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanups: Array<() => void> = [];

  const setState = (next: ChatGPTRealtimeState) => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  };
  const fail = (cause: unknown) => options.onError?.(
    cause instanceof Error ? cause : new Error(String(cause)),
  );

  for (const track of stream.getTracks()) peer.addTrack(track, stream);
  if ((options.addVideoTransceiver ?? true) && stream.getVideoTracks().length === 0) {
    peer.addTransceiver("video", { direction: "sendonly" });
  }

  peer.addEventListener("track", (event) => {
    if (event.track.kind !== "audio") return;
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    audio.muted = outputMuted;
    void audio.play().catch(fail);
  });
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed") fail(new Error("Realtime WebRTC connection failed."));
  });
  channel.addEventListener("message", (message) => {
    void decodeMessageData(message.data).then((data) => {
      const event = parseChatGPTRealtimeEvent(data);
      if (!event) return;
      const payload = getChatGPTRealtimePayload(event);
      if (event.type === "state_update" && isRealtimeState(payload["new_state"])) {
        setState(payload["new_state"]);
      }
      options.onEvent?.(event);
    }).catch(fail);
  });
  channel.addEventListener("close", () => {
    if (!closed) fail(new Error("Realtime data channel closed unexpectedly."));
  });

  const send = (event: ChatGPTRealtimeEvent) => {
    if (channel.readyState !== "open") throw new Error("Realtime data channel is not open.");
    channel.send(encodeChatGPTRealtimeEvent(event));
  };
  const action = (name: ChatGPTRealtimeAction | string, payload?: Record<string, unknown>) => {
    send(createChatGPTRealtimeAction(name, payload));
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, options.iceGatheringTimeoutMs ?? 2_500, options.signal);
    const localSdp = peer.localDescription?.sdp ?? offer.sdp;
    if (!localSdp) throw new Error("Browser did not produce a WebRTC offer SDP.");

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetchImpl(options.endpoint ?? "/api/chatgpt/realtime", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/sdp" },
      body: JSON.stringify({
        sdp: localSdp,
        session: {
          timezone,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          ...options.session,
        },
      }),
      signal: options.signal,
    });
    const answer = await response.text();
    if (!response.ok) throw new Error(`Realtime signaling failed (${response.status}): ${answer.slice(0, 500)}`);
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    await waitForDataChannel(channel, options.connectionTimeoutMs ?? 10_000, options.signal);
    setState("listening");
  } catch (error) {
    channel.close();
    peer.close();
    if (ownsStream) stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  if (options.bargeIn !== false && stream.getAudioTracks().length > 0) {
    cleanups.push(startBargeInMonitor(stream, {
      ...(typeof options.bargeIn === "object" ? options.bargeIn : {}),
      isSpeaking: () => state === "speaking",
      interrupt: () => {
        if (channel.readyState !== "open") return;
        action("stop_speaking");
        setState("listening");
        audio.muted = true;
        if (restoreTimer) clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => { audio.muted = outputMuted; }, 350);
      },
    }));
  }

  return {
    peerConnection: peer,
    dataChannel: channel,
    mediaStream: stream,
    audioElement: audio,
    get state() { return state; },
    send,
    action,
    startListening: () => action("start_listening"),
    stopListening: () => action("stop_listening"),
    stopSpeaking: () => action("stop_speaking"),
    resumeListening: () => action("resume_listening"),
    relayMessage: (payload) => action("relay_message", payload),
    setInputMuted: (muted) => stream.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
    setOutputMuted: (muted) => { outputMuted = muted; audio.muted = muted; },
    close: () => {
      if (closed) return;
      closed = true;
      if (restoreTimer) clearTimeout(restoreTimer);
      cleanups.forEach((cleanup) => cleanup());
      channel.close();
      peer.close();
      if (ownsStream) stream.getTracks().forEach((track) => track.stop());
      audio.srcObject = null;
      setState("halted");
    },
  };
}

const REALTIME_STATES = new Set<ChatGPTRealtimeState>([
  "connecting", "idle", "connected", "halted", "listening",
  "listening_intently", "thinking", "speaking",
]);

function isRealtimeState(value: unknown): value is ChatGPTRealtimeState {
  return typeof value === "string" && REALTIME_STATES.has(value as ChatGPTRealtimeState);
}

async function decodeMessageData(data: unknown): Promise<unknown> {
  return data instanceof Blob ? data.arrayBuffer() : data;
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return waitForEvent(peer, "icegatheringstatechange", timeoutMs, signal, () => peer.iceGatheringState === "complete");
}

function waitForDataChannel(channel: RTCDataChannel, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return waitForEvent(channel, "open", timeoutMs, signal, () => channel.readyState === "open");
}

function waitForEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  done: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const onEvent = () => { if (done()) finish(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${eventName}.`)); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(eventName, onEvent);
      signal?.removeEventListener("abort", abort);
    };
    target.addEventListener(eventName, onEvent);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function startBargeInMonitor(
  stream: MediaStream,
  options: ChatGPTRealtimeBargeInOptions & { isSpeaking: () => boolean; interrupt: () => void },
): () => void {
  const Context = globalThis.AudioContext;
  if (!Context) return () => undefined;
  const context = new Context();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const threshold = options.threshold ?? 0.045;
  const holdMs = options.holdMs ?? 120;
  const cooldownMs = options.cooldownMs ?? 800;
  let aboveSince: number | undefined;
  let lastInterrupt = -Infinity;
  let frame = 0;

  const tick = (now: number) => {
    analyser.getFloatTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    if (options.isSpeaking() && rms >= threshold) {
      aboveSince ??= now;
      if (now - aboveSince >= holdMs && now - lastInterrupt >= cooldownMs) {
        lastInterrupt = now;
        aboveSince = undefined;
        options.interrupt();
      }
    } else {
      aboveSince = undefined;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(frame); void context.close(); };
}
