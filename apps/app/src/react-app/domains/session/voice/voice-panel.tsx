/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Loader2, Mic2, MicOff, Radio, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { PaperGrainGradient } from "@openwork/ui/react";

import { desktopFetch } from "@/app/lib/desktop";
import type { OpenworkServerClient, OpenworkSessionMessage } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { publishInspectorSlice, recordInspectorEvent } from "@/app/lib/app-inspector";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";
import { useControlAction, type OpenworkControlAction } from "../../../shell/control/control-provider";

type VoiceStatus = "idle" | "connecting" | "listening" | "muted" | "speaking" | "error";

type VoiceTimelineEntry = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  error?: boolean;
  at: number;
};

type VoiceRuntimeSnapshot = {
  status: VoiceStatus;
  statusText: string;
  micMuted: boolean;
  micDiagnostics: string;
  realtimeDiagnostics: string;
  entries: VoiceTimelineEntry[];
  latestUserTranscript: string;
  assistantPreview: string;
};

type VoicePanelProps = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  sessionId: string | null;
  onClose: () => void;
};

const DEFAULT_TEXT_COMMAND = "总结当前 FoxWork 会话，并把下一步写入输入框。";
const VOICE_SUGGESTIONS = [
  "朗读当前会话的最新消息",
  "把简短的下一步写入输入框",
  "打开扩展设置",
  "发送输入框中的内容",
];
const TOOL_LABELS: Record<string, string> = {
  openwork_snapshot: "正在检查 FoxWork",
  openwork_list_actions: "正在读取可用操作",
  openwork_execute_action: "正在执行界面操作",
};

const initialVoiceRuntimeSnapshot: VoiceRuntimeSnapshot = {
  status: "idle",
  statusText: "语音控制已就绪。",
  micMuted: false,
  micDiagnostics: "麦克风尚未启动。",
  realtimeDiagnostics: "实时语音尚未连接。",
  entries: [],
  latestUserTranscript: "",
  assistantPreview: "",
};

const voiceRealtime = {
  peer: null as RTCPeerConnection | null,
  channel: null as RTCDataChannel | null,
  stream: null as MediaStream | null,
  remoteAudio: null as HTMLAudioElement | null,
  assistantBuffer: "",
  responseInProgress: false,
  pendingResponse: false,
  micMuted: false,
};

let voiceRuntimeSnapshot: VoiceRuntimeSnapshot = initialVoiceRuntimeSnapshot;
const voiceRuntimeListeners = new Set<() => void>();

function getVoiceRuntimeSnapshot() {
  return voiceRuntimeSnapshot;
}

function subscribeVoiceRuntime(listener: () => void) {
  voiceRuntimeListeners.add(listener);
  return () => {
    voiceRuntimeListeners.delete(listener);
  };
}

function setVoiceRuntimeSnapshot(update: (current: VoiceRuntimeSnapshot) => VoiceRuntimeSnapshot) {
  voiceRuntimeSnapshot = update(voiceRuntimeSnapshot);
  voiceRuntimeListeners.forEach((listener) => listener());
}

function useVoiceRuntimeSnapshot() {
  return useSyncExternalStore(subscribeVoiceRuntime, getVoiceRuntimeSnapshot, getVoiceRuntimeSnapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string) {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const field = value[key];
  return isRecord(field) ? field : {};
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: "Could not serialize tool result" });
  }
}

function humanToolLabel(toolName?: string) {
  if (!toolName) return "FoxWork 操作";
  return TOOL_LABELS[toolName] ?? "自定义操作";
}

function relativeTime(at: number) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟前`;
}

function isMeaningfulTranscript(value: string) {
  return /[\p{Letter}\p{Number}]/u.test(value);
}

function voiceTextArgument(args: unknown) {
  if (typeof args === "string") return args.trim();
  if (isRecord(args) && typeof args.text === "string") return args.text.trim();
  return DEFAULT_TEXT_COMMAND;
}

function voiceAudioArgument(args: unknown) {
  if (!isRecord(args)) return "";
  return typeof args.pcm16Base64 === "string" ? args.pcm16Base64.trim() : "";
}

function messageText(message: OpenworkSessionMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type !== "text") return [];
      if (part.synthetic || part.ignored) return [];
      const text = part.text.trim();
      return text ? [text] : [];
    })
    .join("\n")
    .trim();
}

function buildVoiceSessionContext(messages: OpenworkSessionMessage[]) {
  const transcript = messages.flatMap((message, index) => {
    const role = message.info.role;
    if (role !== "user" && role !== "assistant") return [];
    const text = messageText(message);
    return text ? [{ index, role, text }] : [];
  });

  const included = new Set<number>();
  let assistantCount = 0;
  for (let index = transcript.length - 1; index >= 0 && assistantCount < 3; index -= 1) {
    const item = transcript[index];
    if (!item || item.role !== "assistant") continue;
    included.add(item.index);
    assistantCount += 1;
    const previous = transcript[index - 1];
    if (previous?.role === "user") included.add(previous.index);
  }

  const entries = transcript.filter((item) => included.has(item.index));
  if (!entries.length) return "";
  return entries
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.text}`)
    .join("\n\n")
    .slice(0, 6_000);
}

async function loadVoiceSessionContext(client: OpenworkServerClient, workspaceId: string | null, sessionId: string | null) {
  if (!workspaceId || !sessionId) return "";
  try {
    const response = await client.getSessionMessages(workspaceId, sessionId, { limit: 40 });
    return buildVoiceSessionContext(response.items);
  } catch {
    return "";
  }
}

function waitForDataChannelOpen(channel: RTCDataChannel) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleError);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("实时语音通道未能及时打开。"));
    }, 10_000);
    const handleOpen = () => { cleanup(); resolve(); };
    const handleClose = () => { cleanup(); reject(new Error("实时语音通道在打开前已关闭。")); };
    const handleError = () => { cleanup(); reject(new Error("实时语音通道连接失败。")); };
    channel.addEventListener("open", handleOpen);
    channel.addEventListener("close", handleClose);
    channel.addEventListener("error", handleError);
  });
}

function describeAudioTrack(track: MediaStreamTrack | undefined) {
  if (!track) return "当前未连接麦克风音轨。";
  const muted = track.muted ? "系统已静音" : "系统未静音";
  const enabled = track.enabled ? "已启用" : "已停用";
  const state = track.readyState === "live" ? "工作中" : "已结束";
  return `麦克风音轨${state}，${enabled}，${muted}。`;
}

function setMicDiagnostics(stream: MediaStream | null) {
  const track = stream?.getAudioTracks()[0];
  setVoiceRuntimeSnapshot((current) => ({ ...current, micDiagnostics: describeAudioTrack(track) }));
}

function setRealtimeDiagnostics(text: string) {
  setVoiceRuntimeSnapshot((current) => ({ ...current, realtimeDiagnostics: text }));
}

async function requestMacMicrophoneAccess() {
  const ask = window.__OPENWORK_ELECTRON__?.system?.askMicrophoneAccess;
  if (!ask) return true;
  const result = await ask();
  if (result.platform !== "darwin") return true;
  setVoiceRuntimeSnapshot((current) => ({
    ...current,
    micDiagnostics: result.granted ? "macOS 已允许使用麦克风。" : "macOS 未允许使用麦克风。",
  }));
  return result.granted;
}

async function executeOpenWorkTool(name: string, args: Record<string, unknown>) {
  const control = window.__openworkControl;
  if (!control) return { ok: false, error: "FoxWork 控制功能当前不可用。" };

  if (name === "openwork_snapshot") return { ok: true, snapshot: control.snapshot() };
  if (name === "openwork_list_actions") return { ok: true, actions: control.listActions() };
  if (name === "openwork_execute_action") {
    const actionId = typeof args.actionId === "string" ? args.actionId.trim() : "";
    if (!actionId) return { ok: false, error: "缺少操作标识。" };
    const actionArgs = isRecord(args.args) ? args.args : {};
    return control.execute(actionId, actionArgs);
  }

  return { ok: false, error: `无法识别语音工具：${name}` };
}

function VoiceOrb(props: { status: VoiceStatus; muted: boolean }) {
  const active = props.status === "listening" || props.status === "speaking";
  const colors = props.status === "speaking"
    ? ["#fb7185", "#fbbf24", "#818cf8", "#111827"]
    : props.muted
      ? ["#94a3b8", "#475569", "#cbd5e1", "#0f172a"]
      : ["#8ddde7", "#4f8b7b", "#bfdfa4", "#102b24"];

  return (
    <div className="relative mx-auto flex size-34 items-center justify-center rounded-full border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
      <div className="absolute inset-2 overflow-hidden rounded-full">
        <PaperGrainGradient
          speed={props.status === "speaking" ? 18 : active ? 12 : 4}
          softness={0.16}
          intensity={1}
          noise={0.06}
          shape="sphere"
          colors={colors}
          colorBack="#ffffff00"
          style={{ width: "100%", height: "100%", borderRadius: "9999px" }}
        />
      </div>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_20%,rgba(255,255,255,0.55),transparent_26%)]" />
      <div className={cn(
        "absolute -bottom-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm",
        active && "text-foreground",
      )}>
        {props.status === "speaking" ? "正在说话" : props.muted ? "已静音" : active ? "正在聆听" : "已就绪"}
      </div>
    </div>
  );
}

function VoiceTimelineRow(props: {
  entry: VoiceTimelineEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { entry } = props;
  const isAction = entry.role === "tool" || entry.role === "system";
  const canExpand = isAction && entry.text.length > 72;
  const copy = canExpand && !props.expanded ? `${entry.text.slice(0, 72)}...` : entry.text;

  if (entry.role === "user") {
    return (
      <article className="ml-8 rounded-2xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm leading-relaxed text-foreground">
        {entry.text}
      </article>
    );
  }

  if (entry.role === "assistant") {
    return (
      <article className="mr-8 rounded-2xl border border-border bg-card px-3 py-2 text-sm leading-relaxed text-card-foreground shadow-sm">
        {entry.error ? <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">错误</div> : null}
        <div className="whitespace-pre-wrap break-words">{entry.text}</div>
      </article>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-start gap-2 rounded-xl border bg-muted/40 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted",
        entry.error && "border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/15",
      )}
      onClick={canExpand ? props.onToggle : undefined}
    >
      {canExpand ? (
        props.expanded ? <ChevronDown className="mt-0.5 shrink-0" /> : <ChevronRight className="mt-0.5 shrink-0" />
      ) : (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
      )}
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground/80">
          {entry.toolName ? humanToolLabel(entry.toolName) : entry.error ? "语音错误" : "语音记录"}
        </span>
        <span className="ml-2 text-[10px] opacity-70">{relativeTime(entry.at)}</span>
        {copy ? <span className="mt-1 block whitespace-pre-wrap break-words">{copy}</span> : null}
      </span>
    </button>
  );
}

export function VoicePanel(props: VoicePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const [textCommand, setTextCommand] = useState("");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set());
  const { status, statusText, micMuted, micDiagnostics, realtimeDiagnostics, entries, latestUserTranscript, assistantPreview } = useVoiceRuntimeSnapshot();
  const connected = status === "listening" || status === "speaking" || status === "muted";

  const addEntry = useCallback((role: VoiceTimelineEntry["role"], text: string, options: { toolName?: string; error?: boolean } = {}) => {
    const trimmed = text.trim();
    if ((role === "user" || role === "assistant") && !trimmed) return;
    setVoiceRuntimeSnapshot((current) => ({
      ...current,
      entries: [
        ...current.entries,
        {
          id: `voice-${Date.now()}-${current.entries.length}`,
          role,
          text: trimmed || options.toolName || "工具调用",
          toolName: options.toolName,
          error: options.error,
          at: Date.now(),
        },
      ].slice(-120),
    }));
  }, []);

  const setRuntimeStatus = useCallback((nextStatus: VoiceStatus, text?: string) => {
    setVoiceRuntimeSnapshot((current) => ({
      ...current,
      status: nextStatus,
      statusText: text ?? (
        nextStatus === "connecting" ? "正在连接 OpenAI 实时语音..." :
          nextStatus === "listening" ? "正在聆听，请说出要 FoxWork 完成的操作。" :
            nextStatus === "speaking" ? "FoxWork 正在说话..." :
              nextStatus === "muted" ? "已连接，麦克风已静音。" :
                nextStatus === "error" ? "语音模式需要处理。" :
                  "语音控制已就绪。"
      ),
    }));
  }, []);

  const disconnectRealtime = useCallback((silent = false) => {
    try { voiceRealtime.stream?.getTracks().forEach((track) => track.stop()); } catch {}
    voiceRealtime.stream = null;
    try { voiceRealtime.channel?.close(); } catch {}
    voiceRealtime.channel = null;
    try { voiceRealtime.peer?.close(); } catch {}
    voiceRealtime.peer = null;
    try { voiceRealtime.remoteAudio?.remove(); } catch {}
    voiceRealtime.remoteAudio = null;
    voiceRealtime.assistantBuffer = "";
    voiceRealtime.responseInProgress = false;
    voiceRealtime.pendingResponse = false;
    voiceRealtime.micMuted = false;
    setVoiceRuntimeSnapshot((current) => ({
      ...current,
      micMuted: false,
      micDiagnostics: "麦克风尚未启动。",
      realtimeDiagnostics: "实时语音尚未连接。",
      assistantPreview: "",
    }));
    setRuntimeStatus("idle");
    if (!silent) addEntry("system", "语音会话已停止。");
    recordInspectorEvent("voice.disconnected", { sessionId: props.sessionId });
  }, [addEntry, props.sessionId, setRuntimeStatus]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length, assistantPreview]);

  const toggleEntryExpanded = useCallback((id: string) => {
    setExpandedEntries((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const requestRealtimeResponse = useCallback((channel: RTCDataChannel, deferIfBusy = true) => {
    if (voiceRealtime.responseInProgress) {
      if (deferIfBusy) voiceRealtime.pendingResponse = true;
      return false;
    }
    voiceRealtime.responseInProgress = true;
    channel.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
    return true;
  }, []);

  const handleRealtimeMessage = useCallback(async (raw: string) => {
    let event: unknown = null;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const type = readString(event, "type");

    if (type === "input_audio_buffer.speech_started") {
      setRuntimeStatus("listening", "正在听你说...");
      return;
    }
    if (type === "response.created") {
      voiceRealtime.responseInProgress = true;
      voiceRealtime.pendingResponse = false;
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = readString(event, "transcript").trim();
      if (transcript && isMeaningfulTranscript(transcript)) {
        setVoiceRuntimeSnapshot((current) => ({ ...current, latestUserTranscript: transcript }));
        addEntry("user", transcript);
        recordInspectorEvent("voice.transcript", { sessionId: props.sessionId, transcript });
      }
      return;
    }
    if (type === "response.output_text.delta" || type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
      const delta = readString(event, "delta");
      voiceRealtime.assistantBuffer += delta;
      setVoiceRuntimeSnapshot((current) => ({ ...current, assistantPreview: voiceRealtime.assistantBuffer.trim() }));
      setRuntimeStatus("speaking");
      return;
    }
    if (type === "response.function_call_arguments.done") {
      const toolName = readString(event, "name") || "tool";
      const callId = readString(event, "call_id");
      const args = parseJsonRecord(readString(event, "arguments"));
      addEntry("tool", toolName, { toolName });
      const output = await executeOpenWorkTool(toolName, args);
      if (isRecord(output) && output.ok === false) {
        const error = toChineseUserMessage(output.error, "工具执行失败。");
        addEntry("tool", error, { toolName, error: true });
      }
      const channel = voiceRealtime.channel;
      if (!callId || !channel || channel.readyState !== "open") return;
      channel.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: safeJson(output) },
      }));
      requestRealtimeResponse(channel);
      return;
    }
    if (type === "response.done") {
      const text = voiceRealtime.assistantBuffer.trim();
      if (text) addEntry("assistant", text);
      voiceRealtime.assistantBuffer = "";
      setVoiceRuntimeSnapshot((current) => ({ ...current, assistantPreview: "" }));
      voiceRealtime.responseInProgress = false;
      const channel = voiceRealtime.channel;
      if (voiceRealtime.pendingResponse && channel?.readyState === "open") {
        voiceRealtime.pendingResponse = false;
        requestRealtimeResponse(channel, false);
      } else {
        setRuntimeStatus(voiceRealtime.micMuted ? "muted" : "listening");
      }
      return;
    }
    if (type === "error") {
      voiceRealtime.responseInProgress = false;
      const error = readRecord(event, "error");
      const message = toChineseUserMessage(error.message, "实时语音服务返回错误。");
      addEntry("system", message, { error: true });
      setRuntimeStatus("error", message);
    }
  }, [addEntry, props.sessionId, requestRealtimeResponse, setRuntimeStatus]);

  const connectRealtime = useCallback(async (audioInput = true) => {
    const client = props.client;
    if (!client) throw new Error("FoxWork 本地服务尚未连接。");
    if (audioInput && !navigator.mediaDevices?.getUserMedia) throw new Error("当前环境无法使用麦克风。");

    disconnectRealtime(true);
    setRuntimeStatus("connecting", "正在创建实时语音会话...");
    const sessionContext = await loadVoiceSessionContext(client, props.workspaceId, props.sessionId);
    const realtimeSession = await client.createVoiceRealtimeSession({ sessionContext });

    const peer = new RTCPeerConnection();
    voiceRealtime.peer = peer;
    if (audioInput) {
      setRuntimeStatus("connecting", "正在申请麦克风权限...");
      const macPermissionGranted = await requestMacMicrophoneAccess();
      if (!macPermissionGranted) throw new Error("macOS 未允许使用麦克风。请在“系统设置 > 隐私与安全性 > 麦克风”中允许 FoxWork，然后重启 FoxWork。");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      voiceRealtime.stream = stream;
      setMicDiagnostics(stream);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("mute", () => setMicDiagnostics(stream));
        track.addEventListener("unmute", () => setMicDiagnostics(stream));
        track.addEventListener("ended", () => setMicDiagnostics(stream));
        peer.addTrack(track, stream);
      }
    } else {
      setVoiceRuntimeSnapshot((current) => ({ ...current, micDiagnostics: "当前使用输入文字或注入音频，不使用麦克风。" }));
      peer.addTransceiver("audio", { direction: "recvonly" });
    }

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.style.display = "none";
    document.body.appendChild(audio);
    voiceRealtime.remoteAudio = audio;
    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };

    const channel = peer.createDataChannel("oai-events");
    voiceRealtime.channel = channel;
    channel.addEventListener("message", (event) => void handleRealtimeMessage(String(event.data)));
    channel.addEventListener("close", () => {
      if (voiceRealtime.channel === channel) setRuntimeStatus("idle");
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!offer.sdp) throw new Error("实时语音协商信息不完整。");

    setRuntimeStatus("connecting", "正在打开语音通道...");
    const sdpResponse = await desktopFetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${realtimeSession.clientSecret}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!sdpResponse.ok) {
      throw new Error(`OpenAI 实时语音连接失败，状态码 ${sdpResponse.status}。`);
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    await waitForDataChannelOpen(channel);
    setRealtimeDiagnostics("实时语音通道已打开。");
    setRuntimeStatus("listening", audioInput ? undefined : "已连接，请输入语音命令。");
    addEntry("system", `实时语音已连接模型 ${realtimeSession.model}，可使用 ${realtimeSession.tools.length} 个 FoxWork 工具。`);
    recordInspectorEvent("voice.connected", { sessionId: props.sessionId, model: realtimeSession.model });
  }, [addEntry, disconnectRealtime, handleRealtimeMessage, props.client, props.sessionId, props.workspaceId, setRuntimeStatus]);

  const startVoice = useCallback(async () => {
    try {
      await connectRealtime(true);
      return true;
    } catch (error) {
      disconnectRealtime(true);
      const message = toChineseUserMessage(error, "无法启动语音模式，请检查网络和麦克风权限。");
      setRealtimeDiagnostics(message);
      setRuntimeStatus("error", message);
      addEntry("system", message, { error: true });
      return { ok: false, error: message };
    }
  }, [addEntry, connectRealtime, disconnectRealtime, setRuntimeStatus]);

  const stopVoice = useCallback(() => {
    disconnectRealtime();
    return true;
  }, [disconnectRealtime]);

  const toggleMic = useCallback(() => {
    const nextMuted = !voiceRealtime.micMuted;
    voiceRealtime.micMuted = nextMuted;
    setVoiceRuntimeSnapshot((current) => ({ ...current, micMuted: nextMuted }));
    voiceRealtime.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setRuntimeStatus(nextMuted ? "muted" : "listening");
    return { muted: nextMuted };
  }, [setRuntimeStatus]);

  const sendTextCommand = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value) return { ok: false, error: "请输入文字命令。" };
    if (!voiceRealtime.channel || voiceRealtime.channel.readyState !== "open") {
      try {
        await connectRealtime(false);
      } catch (error) {
        const message = toChineseUserMessage(error, "无法连接实时语音服务。");
        setRuntimeStatus("error", message);
        addEntry("system", message, { error: true });
        return { ok: false, error: message };
      }
    }
    const channel = voiceRealtime.channel;
    if (!channel || channel.readyState !== "open") return { ok: false, error: "实时语音通道尚未打开。" };
    addEntry("user", value);
    channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: value }] },
    }));
    requestRealtimeResponse(channel);
    return { ok: true, text: value };
  }, [addEntry, connectRealtime, requestRealtimeResponse, setRuntimeStatus]);

  const injectAudio = useCallback(async (args: unknown) => {
    const audio = voiceAudioArgument(args);
    if (!audio) return { ok: false, error: "缺少 PCM16 音频数据。" };
    if (!voiceRealtime.channel || voiceRealtime.channel.readyState !== "open") {
      const started = await startVoice();
      if (isRecord(started) && started.ok === false) return started;
    }
    const channel = voiceRealtime.channel;
    if (!channel || channel.readyState !== "open") return { ok: false, error: "实时语音通道尚未打开。" };
    addEntry("system", "已将测试音频送入实时语音缓冲区。");
    channel.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    requestRealtimeResponse(channel);
    return { ok: true, bytesBase64: audio.length };
  }, [addEntry, requestRealtimeResponse, startVoice]);

  const injectTranscript = useCallback(async (args: unknown) => {
    const text = voiceTextArgument(args);
    setVoiceRuntimeSnapshot((current) => ({ ...current, latestUserTranscript: text }));
    addEntry("user", text);
    window.dispatchEvent(new CustomEvent("openwork:voice-transcript", { detail: { text } }));
    recordInspectorEvent("voice.inject_transcript", { sessionId: props.sessionId, text });
    return { ok: true, transcript: text };
  }, [addEntry, props.sessionId]);

  useEffect(() => {
    const dispose = publishInspectorSlice("voice", () => ({
      sessionId: props.sessionId,
      status,
      statusText,
      connected,
      micMuted,
      latestUserTranscript,
      assistantPreview,
      textCommandLength: textCommand.length,
      timeline: entries.slice(-12).map((entry) => ({
        role: entry.role,
        text: entry.text,
        toolName: entry.toolName,
        error: entry.error === true,
        at: entry.at,
      })),
    }));
    return dispose;
  }, [assistantPreview, connected, entries, latestUserTranscript, micDiagnostics, micMuted, props.sessionId, realtimeDiagnostics, status, statusText, textCommand.length]);

  const startAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.start",
    label: "启动语音模式",
    description: "连接 OpenAI 实时语音并开始聆听。",
    sideEffect: "external",
    disabled: !props.client || connected || status === "connecting",
    targetRef: panelRef,
    execute: startVoice,
  }), [connected, props.client, startVoice, status]);
  useControlAction(startAction);

  const stopAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.stop",
    label: "停止语音模式",
    description: "断开当前实时语音会话。",
    sideEffect: "external",
    disabled: !connected,
    targetRef: panelRef,
    execute: stopVoice,
  }), [connected, stopVoice]);
  useControlAction(stopAction);

  const muteAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.toggle_mute",
    label: micMuted ? "取消语音静音" : "将语音静音",
    description: "切换麦克风状态，不关闭实时语音会话。",
    sideEffect: "none",
    disabled: !connected,
    targetRef: panelRef,
    execute: toggleMic,
  }), [connected, micMuted, toggleMic]);
  useControlAction(muteAction);

  const injectTranscriptAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.inject_transcript",
    label: "注入语音转写",
    description: "测试用操作：添加语音转写并放入输入框。",
    sideEffect: "mutation",
    requiresArgs: true,
    args: [{ name: "text", type: "string", required: true, description: "要注入的转写文字。" }],
    previewArgs: { text: DEFAULT_TEXT_COMMAND },
    targetRef: panelRef,
    execute: injectTranscript,
  }), [injectTranscript]);
  useControlAction(injectTranscriptAction);

  const sendTextAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.send_text",
    label: "通过语音模式发送文字",
    description: "通过当前 OpenAI 实时语音会话发送文字命令。",
    sideEffect: "external",
    requiresArgs: true,
    args: [{ name: "text", type: "string", required: true, description: "要发送给实时语音模型的文字命令。" }],
    previewArgs: { text: DEFAULT_TEXT_COMMAND },
    targetRef: panelRef,
    execute: (args) => sendTextCommand(voiceTextArgument(args)),
  }), [sendTextCommand]);
  useControlAction(sendTextAction);

  const injectAudioAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.inject_audio",
    label: "注入语音音频",
    description: "测试用操作：向 OpenAI 实时语音缓冲区发送 PCM16 音频。",
    sideEffect: "external",
    requiresArgs: true,
    args: [{ name: "pcm16Base64", type: "string", required: true, description: "Base64 编码的 PCM16 单声道音频。" }],
    targetRef: panelRef,
    execute: injectAudio,
  }), [injectAudio]);
  useControlAction(injectAudioAction);

  const statusAction = useMemo<OpenworkControlAction>(() => ({
    id: "voice.status",
    label: "读取语音模式状态",
    description: "返回语音模式运行状态，供测试和智能体使用。",
    sideEffect: "none",
    execute: () => ({ status, statusText, connected, micMuted, micDiagnostics, realtimeDiagnostics, latestUserTranscript, assistantPreview }),
  }), [assistantPreview, connected, latestUserTranscript, micDiagnostics, micMuted, realtimeDiagnostics, status, statusText]);
  useControlAction(statusAction);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span
              className={cn(
                "size-2 rounded-full bg-muted-foreground",
                status === "connecting" && "animate-pulse bg-amber-9",
                (status === "listening" || status === "speaking") && "bg-green-9",
                status === "error" && "bg-destructive",
              )}
            />
            <Radio className="text-primary" />
            语音模式
          </div>
          <div className="truncate text-xs text-muted-foreground">通过 FoxWork 界面控制实时语音</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={props.onClose} aria-label="关闭语音模式">
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ScrollAreaViewport>
          <div className="flex flex-col gap-5 px-4 py-5">
          <VoiceOrb status={status} muted={micMuted} />

          <div className="text-center">
            <div className="text-sm font-medium text-foreground">{statusText}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              可以说“输入下一步”“发送内容”或“朗读最新消息”。
            </div>
          </div>

          {entries.length === 0 && !assistantPreview ? (
            <div className="flex flex-wrap justify-center gap-1.5">
              {VOICE_SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="xs"
                  className="rounded-full"
                  onClick={() => setTextCommand(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void startVoice()} disabled={!props.client || connected || status === "connecting"}>
              {status === "connecting" ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Mic2 data-icon="inline-start" />}
              开始语音
            </Button>
            <Button variant="outline" onClick={stopVoice} disabled={!connected}>
              <Square data-icon="inline-start" />
              停止
            </Button>
            <Button variant="outline" onClick={toggleMic} disabled={!connected} className="col-span-2">
              {micMuted ? <Mic2 data-icon="inline-start" /> : <MicOff data-icon="inline-start" />}
              {micMuted ? "取消麦克风静音" : "将麦克风静音"}
            </Button>
          </div>

          {!props.client ? (
            <Card variant="outline" size="sm">
              <CardHeader>
                <CardTitle>需要连接本地服务</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                语音模式需要连接 FoxWork 本地服务，由服务生成短期实时语音凭据，避免在界面进程中暴露 API 密钥。
              </CardContent>
            </Card>
          ) : null}

          {assistantPreview ? (
            <Card variant="outline" size="sm" className="overflow-hidden">
              <CardContent className="relative p-0">
                <div className="absolute inset-x-0 top-0 h-1 overflow-hidden">
                  <PaperGrainGradient
                    speed={16}
                    softness={0.14}
                    intensity={1}
                    noise={0.05}
                    shape="wave"
                    colors={["#818cf8", "#fb7185", "#fbbf24", "#34d399"]}
                    colorBack="#ffffff00"
                    style={{ width: "100%", height: "100%" }}
                  />
                </div>
                <div className="flex flex-col gap-2 px-3 pb-3 pt-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">正在生成回答</div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-card-foreground" aria-live="polite">
                    {assistantPreview}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card variant="outline" size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="text-primary" />
                语音诊断
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">连接：</span> {realtimeDiagnostics}
              </div>
              <div>
                <span className="font-medium text-foreground">麦克风：</span> {micDiagnostics}
              </div>
              {status === "error" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-destructive">
                  {statusText}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card variant="outline" size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="text-primary" />
                文字语音命令
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InputGroup>
                <InputGroupTextarea
                  value={textCommand}
                  onChange={(event) => setTextCommand(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey) return;
                    event.preventDefault();
                    const text = textCommand;
                    setTextCommand("");
                    void sendTextCommand(text);
                  }}
                  placeholder={DEFAULT_TEXT_COMMAND}
                  rows={3}
                />
                <InputGroupAddon align="block-end" className="justify-between border-t border-border">
                  <span className="text-xs text-muted-foreground">按回车发送，Shift+回车换行</span>
                  <InputGroupButton
                    variant="outline"
                    onClick={() => {
                      const text = textCommand;
                      setTextCommand("");
                      void sendTextCommand(text);
                    }}
                    disabled={!textCommand.trim() || status === "connecting"}
                  >
                    <SendHorizontal data-icon="inline-start" />
                    发送
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">时间线</div>
            {entries.length ? entries.map((entry) => (
              <VoiceTimelineRow
                key={entry.id}
                entry={entry}
                expanded={expandedEntries.has(entry.id)}
                onToggle={() => toggleEntryExpanded(entry.id)}
              />
            )) : (
              <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                启动语音，或通过界面 MCP 注入转写后，可在这里查看时间线。
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>
          </div>
        </ScrollAreaViewport>
      </ScrollArea>
    </div>
  );
}
