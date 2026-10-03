import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  Paperclip,
  MoreHorizontal,
  X,
  Reply,
  Pencil,
  Trash2,
  File,
  Loader2,
  Mic,
  LockKeyhole,
  LockKeyholeOpen,
  Camera,
  Smile,
  Copy,
  Forward,
  CheckCheck,
  Play,
  RotateCcw,
  Phone,
  PhoneCall,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isOnline } from "@/lib/auth";
import { type MessageRow, type ProfileLite, formatDivider } from "@/lib/chat";
import { uploadFile } from "@/lib/storage";
import { ChatAvatar, useRemoteUrl } from "@/components/RemoteImage";
import { Button } from "@/components/ui/button";
import { useCalls, type CallRow } from "@/lib/calls";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/chat/$id")({
  validateSearch: (search: Record<string, unknown>): { message?: string } =>
    typeof search["message"] === "string" ? { message: search["message"] } : {},
  head: () => ({
    meta: [
      { title: "Conversation — Ripple" },
      { name: "description", content: "Your private Ripple conversation." },
      { property: "og:title", content: "Conversation — Ripple" },
      { property: "og:description", content: "Messages, photos and tapbacks with your people." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Conversation,
});

type Reaction = { message_id: string; user_id: string; emoji: string };
type Member = { user_id: string; last_read_at: string };
type FailedRecording = {
  file: globalThis.File;
  kind: "voice" | "video-note";
  duration: number;
};

function CallEntry({
  call,
  userId,
  onCallBack,
}: {
  call: CallRow;
  userId?: string;
  onCallBack: () => void;
}) {
  const outgoing = call.initiator_id === userId;
  const Icon = call.kind === "video" ? Video : Phone;
  const label =
    call.status === "declined"
      ? "Declined"
      : call.status === "missed"
        ? "Missed"
        : call.status === "ended"
          ? "Call ended"
          : "Call";
  return (
    <div className="my-3 flex justify-center">
      <div className="flex items-center gap-3 rounded-[24px] border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-sm">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span>
          <span className="block font-medium">{label}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {outgoing ? <PhoneCall className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
            {call.kind === "video" ? "Video" : "Voice"} · {formatDivider(call.created_at)}
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onCallBack}
          aria-label="Call back"
          className="rounded-full text-primary hover:bg-primary/10"
        >
          <PhoneCall className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
function VoiceAttachment({ url, onRetry }: { url: string; onRetry: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const bars = [
    "h-3",
    "h-5",
    "h-3",
    "h-6",
    "h-4",
    "h-7",
    "h-3",
    "h-5",
    "h-7",
    "h-4",
    "h-6",
    "h-3",
    "h-5",
    "h-7",
    "h-3",
    "h-5",
    "h-3",
    "h-6",
    "h-4",
    "h-3",
  ];
  return (
    <div className="flex min-w-[190px] items-center gap-3" aria-label="Voice note">
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onError={() => {
          setPlaying(false);
          setPlaybackFailed(true);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          setProgress(el.duration ? el.currentTime / el.duration : 0);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="h-11 w-11 shrink-0 rounded-full"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={() => {
          if (!audio.current) return;
          if (audio.current.paused)
            void audio.current
              .play()
              .then(() => {
                setPlaying(true);
                setPlaybackFailed(false);
              })
              .catch(() => {
                setPlaybackFailed(true);
                toast.error("Could not play voice note. Refresh it and try again.");
              });
          else {
            audio.current.pause();
            setPlaying(false);
          }
        }}
      >
        {playing ? <span className="font-bold">Ⅱ</span> : <Play />}
      </Button>
      <div
        className="flex h-10 flex-1 items-center gap-0.5"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Voice note progress"
      >
        {bars.map((height, index) => (
          <span
            key={index}
            className={`w-1 flex-1 rounded-full ${height} ${index / bars.length <= progress ? "bg-primary" : "bg-muted-foreground/50"}`}
          />
        ))}
      </div>
      {playbackFailed && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh voice note"
          onClick={() => {
            setPlaybackFailed(false);
            onRetry();
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function Attachment({ message }: { message: MessageRow }) {
  const [urlRevision, setUrlRevision] = useState(0);
  const url = useRemoteUrl("attachments", message.attachment_url, urlRevision);
  if (!url) return <span className="text-sm">Loading attachment…</span>;
  if (message.media_kind === "voice" || message.attachment_type?.startsWith("audio/"))
    return <VoiceAttachment url={url} onRetry={() => setUrlRevision((revision) => revision + 1)} />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {message.attachment_type?.startsWith("image/") ? (
        <img
          src={url}
          alt={message.attachment_name ?? "Shared photo"}
          className="max-h-80 w-full rounded-xl object-contain"
          loading="lazy"
        />
      ) : message.media_kind === "video-note" ? (
        <video src={url} controls playsInline className="h-44 w-44 rounded-full object-cover" />
      ) : message.attachment_type?.startsWith("video/") ? (
        <video src={url} controls playsInline className="max-h-80 w-full rounded-xl" />
      ) : (
        <span className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-3">
          <File className="h-5 w-5" />
          <span className="min-w-0">
            <span className="block truncate">{message.attachment_name ?? "File"}</span>
            <span className="text-xs text-muted-foreground">
              {message.attachment_size
                ? `${Math.ceil(message.attachment_size / 1024)} KB`
                : (message.attachment_type ?? "Attachment")}
            </span>
          </span>
        </span>
      )}
    </a>
  );
}

function Conversation() {
  const { id } = Route.useParams();
  const { message: targetMessage } = Route.useSearch();
  const { user, loading } = useAuth();
  const { startCall } = useCalls();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [callEntries, setCallEntries] = useState<CallRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState("Conversation");
  const [group, setGroup] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState<MessageRow | null>(null);
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const [recording, setRecording] = useState<"voice" | "video-note" | null>(null);
  const [failedRecording, setFailedRecording] = useState<FailedRecording | null>(null);
  const [retryingRecording, setRetryingRecording] = useState(false);
  const [recordingLocked, setRecordingLocked] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(() => Array(32).fill(0.08));
  const [stickersOpen, setStickersOpen] = useState(false);
  const [attachmentSheet, setAttachmentSheet] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingPending = useRef(false);
  const releasePending = useRef(false);
  const cancelPending = useRef(false);
  const recordedChunks = useRef<Blob[]>([]);
  const recordingGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const recordingStartedAt = useRef(0);
  const waveformContext = useRef<AudioContext | null>(null);
  const waveformFrame = useRef<number | null>(null);
  const touchStart = useRef<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const emojiInput = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAt.current) / 1000));
    }, 200);
    return () => window.clearInterval(timer);
  }, [recording]);

  function stopWaveform() {
    if (waveformFrame.current !== null) cancelAnimationFrame(waveformFrame.current);
    waveformFrame.current = null;
    const context = waveformContext.current;
    waveformContext.current = null;
    if (context && context.state !== "closed") void context.close();
  }

  function startWaveform(stream: MediaStream) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      context.createMediaStreamSource(stream).connect(analyser);
      waveformContext.current = context;
      const samples = new Uint8Array(analyser.fftSize);
      let lastSampleAt = 0;
      const sample = (timestamp: number) => {
        if (timestamp - lastSampleAt >= 100) {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const value of samples) energy += ((value - 128) / 128) ** 2;
          const amplitude = Math.max(0.08, Math.min(1, Math.sqrt(energy / samples.length) * 4));
          setWaveform((current) => [...current.slice(1), amplitude]);
          lastSampleAt = timestamp;
        }
        waveformFrame.current = requestAnimationFrame(sample);
      };
      void context.resume();
      waveformFrame.current = requestAnimationFrame(sample);
    } catch (error) {
      console.warn("[chat] Live voice waveform is unavailable", error);
    }
  }

  const refresh = useCallback(async () => {
    if (!user) return;
    const [conv, rows, membership] = await Promise.all([
      supabase.from("conversations").select("name, is_group").eq("id", id).single(),
      supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("conversation_members")
        .select("user_id, last_read_at")
        .eq("conversation_id", id),
    ]);
    if (conv.error || rows.error || membership.error) {
      setError("This conversation could not be loaded.");
      setReady(true);
      return;
    }
    const people = await supabase
      .from("profiles")
      .select("*")
      .in(
        "id",
        membership.data.map((m) => m.user_id),
      );
    const ps = people.data ?? [];
    setProfiles(ps);
    setMembers(membership.data);
    setGroup(conv.data.is_group);
    setTitle(
      conv.data.name ||
        ps
          .filter((p) => p.id !== user.id)
          .map((p) => p.display_name)
          .join(", ") ||
        "You",
    );
    setMessages((rows.data ?? []) as MessageRow[]);
    const { data: calls, error: callsError } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (!callsError) setCallEntries((calls ?? []) as CallRow[]);
    setError("");
    setReady(true);
    if (rows.data.length) {
      const r = await supabase
        .from("reactions")
        .select("message_id, user_id, emoji")
        .in(
          "message_id",
          rows.data.map((m) => m.id),
        );
      setReactions(r.data ?? []);
    } else setReactions([]);
    if (document.visibilityState === "visible") {
      const latest = rows.data.at(-1)?.created_at;
      const mine = membership.data.find((m) => m.user_id === user.id);
      if (latest && mine && latest > mine.last_read_at)
        await supabase
          .from("conversation_members")
          .update({ last_read_at: new Date().toISOString() })
          .eq("conversation_id", id)
          .eq("user_id", user.id);
    }
  }, [id, user]);

  const presenceIds = profiles
    .filter((profile) => profile.id !== user?.id)
    .map((profile) => profile.id)
    .join(",");

  useEffect(() => {
    if (!user) return;
    const update = async () => {
      const ids = presenceIds ? presenceIds.split(",") : [];
      if (!ids.length) return;
      const { data } = await supabase.from("profiles").select("id, last_seen").in("id", ids);
      if (data)
        setProfiles((current) =>
          current.map((p) => ({
            ...p,
            last_seen: data.find((row) => row.id === p.id)?.last_seen ?? p.last_seen,
          })),
        );
      setNow(Date.now());
    };
    const timer = setInterval(() => void update(), 15000);
    return () => clearInterval(timer);
  }, [presenceIds, user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const channel = supabase
      .channel(`chat-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reactions" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${id}`,
        },
        () => void refresh(),
      )
      .subscribe();
    const poll = setInterval(() => {
      void supabase
        .from("typing_status")
        .select("user_id")
        .eq("conversation_id", id)
        .neq("user_id", user.id)
        .gt("updated_at", new Date(Date.now() - 4000).toISOString())
        .then(({ data }) => setTyping((data ?? []).map((t) => t.user_id)));
    }, 2000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", visible);
      void supabase.from("typing_status").delete().eq("conversation_id", id).eq("user_id", user.id);
    };
  }, [id, user, refresh]);
  useEffect(() => {
    if (targetMessage)
      document
        .getElementById(`message-${targetMessage}`)
        ?.scrollIntoView({ behavior: "instant", block: "center" });
    else bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [messages.length, typing.length, targetMessage]);

  async function send() {
    if (!user || busy || (!body.trim() && !file)) return;
    setBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.user?.id || session.session.user.id !== user.id) {
        throw new Error("Your session expired. Sign in again to send messages.");
      }
      if (editing) {
        const { error } = await supabase
          .from("messages")
          .update({ body: body.trim(), edited_at: new Date().toISOString() })
          .eq("id", editing.id)
          .eq("sender_id", user.id);
        if (error) throw error;
      } else {
        const path = file ? await uploadFile("attachments", user.id, file) : null;
        const baseMessage = {
          conversation_id: id,
          sender_id: user.id,
          body: body.trim() || null,
          attachment_url: path,
          attachment_type: file?.type || null,
          reply_to: reply?.id ?? null,
        };
        const result = await supabase.from("messages").insert(baseMessage);
        const { error } = result;
        if (error) throw error;
      }
      setBody("");
      setFile(null);
      setReply(null);
      setEditing(null);
      await supabase
        .from("typing_status")
        .delete()
        .eq("conversation_id", id)
        .eq("user_id", user.id);
      await refresh();
    } catch (error) {
      console.error("[chat] Message send failed", error);
      toast.error(
        error instanceof Error
          ? `Message could not be sent: ${error.message}`
          : "Message could not be sent. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendRecordedFile(
    file: globalThis.File,
    kind: FailedRecording["kind"],
    duration: number,
  ) {
    if (!user || retryingRecording) return;
    setRetryingRecording(true);
    let uploadedPath: string | null = null;
    try {
      uploadedPath = await uploadFile("attachments", user.id, file);
      const { error: insertError } = await supabase.from("messages").insert({
        conversation_id: id,
        sender_id: user.id,
        body: null,
        attachment_url: uploadedPath,
        attachment_type: file.type,
        media_kind: kind,
        media_duration: duration,
        reply_to: reply?.id ?? null,
      });
      if (insertError) throw insertError;
      setFailedRecording(null);
      setReply(null);
      await refresh();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("attachments").remove([uploadedPath]);
      console.error("[chat] Voice note send failed", error);
      setFailedRecording({ file, kind, duration });
      toast.error("Voice note could not be sent. Retry without recording again.");
    } finally {
      setRetryingRecording(false);
    }
  }

  async function startRecording(kind: "voice" | "video-note") {
    if (recording || recordingPending.current || !user) return;
    recordingPending.current = true;
    releasePending.current = false;
    cancelPending.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Recording is not available in this browser.");
      recordingPending.current = false;
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === "video-note",
      });
    } catch {
      recordingPending.current = false;
      if (!cancelPending.current)
        toast.error("Allow microphone access in your browser settings to record a voice note.");
      return;
    }
    if (cancelPending.current) {
      stream.getTracks().forEach((track) => track.stop());
      recordingPending.current = false;
      return;
    }
    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      recordingPending.current = false;
      toast.error("Recording is not supported on this device.");
      return;
    }
    recordedChunks.current = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) recordedChunks.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.current = mediaRecorder;
    setRecording(kind);
    setRecordingLocked(false);
    setRecordingSeconds(0);
    setWaveform(Array(32).fill(0.08));
    recordingStartedAt.current = Date.now();
    mediaRecorder.start();
    if (kind === "voice") startWaveform(stream);
    recordingPending.current = false;
    if (cancelPending.current) void cancelRecording();
    else if (releasePending.current) void stopRecording(kind);
  }

  async function cancelRecording() {
    cancelPending.current = true;
    releasePending.current = false;
    if (recordingPending.current) {
      setRecording(null);
      setRecordingLocked(false);
      return;
    }
    const mediaRecorder = recorder.current;
    recorder.current = null;
    recordedChunks.current = [];
    stopWaveform();
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    setRecording(null);
    setRecordingLocked(false);
    setRecordingSeconds(0);
  }

  async function stopRecording(pendingKind?: "voice" | "video-note") {
    if (recordingPending.current) {
      releasePending.current = true;
      return;
    }
    const mediaRecorder = recorder.current;
    const kind = pendingKind ?? recording;
    if (!mediaRecorder || !kind || !user) return;
    recorder.current = null;
    stopWaveform();
    setRecordingLocked(false);
    const blob = await new Promise<Blob>((resolve) => {
      const finish = () =>
        resolve(
          new Blob(recordedChunks.current, {
            type: mediaRecorder.mimeType || (kind === "voice" ? "audio/webm" : "video/webm"),
          }),
        );
      mediaRecorder.addEventListener("stop", finish, { once: true });
      if (mediaRecorder.state === "recording") mediaRecorder.stop();
      else finish();
    });
    if (!blob.size) {
      toast.error("Recording was empty. Hold the microphone longer and try again.");
      setRecording(null);
      return;
    }
    const file = new globalThis.File([blob], `${kind}-${crypto.randomUUID()}.webm`, {
      type: blob.type,
    });
    const duration = Math.max(1, Math.round((Date.now() - recordingStartedAt.current) / 1000));
    setRecording(null);
    setRecordingSeconds(0);
    await sendRecordedFile(file, kind, duration);
  }

  function toggleSelected(messageId: string) {
    setMultiSelect((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  async function react(messageId: string, emoji: string) {
    if (!user) return;
    const exists = reactions.some(
      (r) => r.message_id === messageId && r.user_id === user.id && r.emoji === emoji,
    );
    const result = exists
      ? await supabase.from("reactions").delete().eq("message_id", messageId).eq("user_id", user.id)
      : await supabase
          .from("reactions")
          .upsert(
            { message_id: messageId, user_id: user.id, emoji },
            { onConflict: "message_id,user_id" },
          );
    if (result.error) toast.error("Could not update tapback.");
    setSelected(null);
    await refresh();
  }
  async function remove(m: MessageRow) {
    if (!user || !window.confirm("Delete this message for everyone?")) return;
    const { error } = await supabase
      .from("messages")
      .update({
        deleted_at: new Date().toISOString(),
        body: null,
        attachment_url: null,
        attachment_type: null,
      })
      .eq("id", m.id)
      .eq("sender_id", user.id);
    if (error) toast.error("Could not delete message.");
    setSelected(null);
    await refresh();
  }
  if (!loading && !user)
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Button asChild>
          <Link to="/auth">Sign in to view messages</Link>
        </Button>
      </main>
    );
  const other = profiles.find((p) => p.id !== user?.id);
  const online =
    !group &&
    isOnline(other?.last_seen) &&
    now - new Date(other?.last_seen ?? 0).getTime() < 70_000;
  const lastOutgoing = messages.filter((m) => m.sender_id === user?.id).at(-1)?.id;
  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="chat-app-bar liquid-chrome relative flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-foreground hover:bg-primary/10"
        >
          <Link to="/" aria-label="Back to messages">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <div className="relative shrink-0">
            <ChatAvatar name={title} path={group ? null : other?.avatar_url} size={40} />
            {online && (
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-presence" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <h1 className="truncate text-[15px] font-semibold tracking-[0.01em]">{title}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {typing.length > 0
                ? "typing…"
                : group
                  ? `${profiles.length} members`
                  : online
                    ? "Online"
                    : "Offline"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full text-foreground hover:bg-primary/10"
          aria-label="Start voice call"
          onClick={() => void startCall(id, "voice", title)}
        >
          <Phone className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full text-foreground hover:bg-primary/10"
          aria-label="Start video call"
          onClick={() => void startCall(id, "video", title)}
        >
          <Video className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-foreground hover:bg-primary/10"
          aria-label="Conversation options"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </header>
      <section aria-label="Messages" className="flex-1 overflow-y-auto bg-background px-4 py-5">
        {!ready ? (
          <Loader2 className="mx-auto animate-spin text-muted-foreground" />
        ) : error ? (
          <div role="alert" className="text-center text-muted-foreground">
            {error}
            <Button variant="link" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No messages yet</p>
        ) : null}
        {[
          ...messages.map((message) => ({
            type: "message" as const,
            at: message.created_at,
            message,
          })),
          ...callEntries.map((call) => ({ type: "call" as const, at: call.created_at, call })),
        ]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((item) => {
            if (item.type === "call") {
              const callEntryProps = user?.id ? { userId: user.id } : {};
              return (
                <CallEntry
                  key={`call-${item.call.id}`}
                  call={item.call}
                  {...callEntryProps}
                  onCallBack={() => void startCall(id, item.call.kind, title)}
                />
              );
            }
            const m = item.message;
            const i = messages.findIndex((message) => message.id === m.id);
            const own = m.sender_id === user?.id;
            const quoted = messages.find((x) => x.id === m.reply_to);
            const rs = reactions.filter((r) => r.message_id === m.id);
            const otherMembers = members.filter((member) => member.user_id !== user?.id);
            const readByAll =
              otherMembers.length > 0 &&
              members.every(
                (member) =>
                  member.user_id === user?.id ||
                  new Date(member.last_read_at) >= new Date(m.created_at),
              );
            const readBySomeone = otherMembers.some(
              (member) => new Date(member.last_read_at) >= new Date(m.created_at),
            );
            const receipt =
              own && m.id === lastOutgoing
                ? readByAll
                  ? "Read"
                  : readBySomeone
                    ? "Delivered"
                    : "Sent"
                : null;
            const showDate =
              i === 0 ||
              new Date(m.created_at).getTime() -
                new Date(messages[i - 1]?.created_at ?? 0).getTime() >
                300000;
            return (
              <div
                key={m.id}
                id={`message-${m.id}`}
                data-actions-open={selected === m.id ? "true" : undefined}
                className={`message-row group/message ${targetMessage === m.id ? "rounded-lg ring-2 ring-primary" : ""} ${multiSelect.has(m.id) ? "bg-primary/10" : ""}`}
                onPointerDown={(event) => {
                  touchStart.current = event.clientX;
                }}
                onPointerUp={(event) => {
                  if (
                    touchStart.current !== null &&
                    Math.abs(event.clientX - touchStart.current) > 56 &&
                    event.clientX > touchStart.current
                  )
                    setReply(m);
                  touchStart.current = null;
                }}
              >
                {showDate && (
                  <p className="date-divider my-5 text-center">
                    <span className="date-divider-chip liquid-chrome">
                      {formatDivider(m.created_at)}
                    </span>
                  </p>
                )}
                <div className={`mb-2 flex flex-col ${own ? "items-end" : "items-start"}`}>
                  {group && !own && (
                    <span className="mb-1 pl-3 text-xs text-muted-foreground">
                      {profiles.find((p) => p.id === m.sender_id)?.display_name}
                    </span>
                  )}
                  <div
                    className={`relative max-w-[82%] rounded-[24px] px-3.5 py-2 shadow-sm ${
                      own
                        ? "sent-bubble rounded-br-lg bg-bubble-out text-bubble-out-foreground"
                        : "rounded-bl-lg border border-border bg-bubble-in text-bubble-in-foreground"
                    }`}
                    onDoubleClick={() => !m.deleted_at && setSelected(m.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelected(m.id);
                    }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="message-action-chip liquid-chrome absolute -right-3 -top-3 h-6 w-6 rounded-full p-0 text-foreground"
                      aria-label={`Message actions ${i + 1}`}
                      tabIndex={0}
                      onClick={() => setSelected(selected === m.id ? null : m.id)}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                    {quoted && (
                      <p className="mb-2 border-l-2 border-current pl-2 text-xs opacity-75">
                        {quoted.deleted_at ? "Message deleted" : quoted.body || "Attachment"}
                      </p>
                    )}
                    {m.deleted_at ? (
                      <p className="text-sm italic">Message deleted</p>
                    ) : (
                      <>
                        {m.attachment_url && <Attachment message={m} />}
                        {m.body && (
                          <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] [overflow-wrap:anywhere]">
                            {m.body}
                          </p>
                        )}
                      </>
                    )}
                    <div className="mt-1 flex min-h-3 items-center justify-end gap-1 text-[10px] leading-none text-ink-tertiary">
                      {m.edited_at && <span>Edited</span>}
                      <time dateTime={m.created_at}>
                        {new Date(m.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      {receipt && (
                        <span className="inline-flex items-center gap-0.5">
                          {receipt === "Read" && (
                            <CheckCheck className="h-3 w-3" aria-hidden="true" />
                          )}
                          {receipt}
                        </span>
                      )}
                    </div>
                  </div>
                  {!m.deleted_at && rs.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span
                        className="rounded-full border border-border bg-card px-2 text-sm"
                        aria-label="Tapbacks"
                      >
                        {Array.from(new Set(rs.map((r) => r.emoji))).join(" ")}{" "}
                        {rs.length > 1 ? rs.length : ""}
                      </span>
                    </div>
                  )}
                  {selected === m.id && (
                    <div className="my-1 max-w-full rounded-lg border border-border bg-popover p-2 shadow-sm">
                      <div className="flex flex-wrap gap-1">
                        {["❤️", "👍", "👎", "😂", "‼️", "❓"].map((emoji) => (
                          <Button
                            key={emoji}
                            variant="ghost"
                            size="icon"
                            aria-label={`React ${emoji}`}
                            onClick={() => void react(m.id, emoji)}
                          >
                            {emoji}
                          </Button>
                        ))}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReply(m);
                            setEditing(null);
                            setSelected(null);
                          }}
                        >
                          <Reply />
                          Reply
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void navigator.clipboard?.writeText(m.body ?? "");
                            setSelected(null);
                          }}
                        >
                          <Copy />
                          Copy
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleSelected(m.id)}>
                          <CheckCheck />
                          Select
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                          <Forward />
                          Forward
                        </Button>
                        {own && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!m.body}
                              onClick={() => {
                                setEditing(m);
                                setBody(m.body ?? "");
                                setReply(null);
                                setFile(null);
                                setSelected(null);
                              }}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void remove(m)}>
                              <Trash2 />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        {typing.length > 0 && (
          <div
            role="status"
            aria-label={`${typing.map((id) => profiles.find((profile) => profile.id === id)?.display_name ?? "Someone").join(", ")} typing`}
            className="typing-bubble mt-3 w-fit rounded-[24px] border border-border bg-bubble-in px-4 py-3 text-bubble-in-foreground"
          >
            <span className="sr-only">Someone is typing</span>
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        <div ref={bottom} />
      </section>
      <footer className="relative shrink-0 px-0 py-0">
        {multiSelect.size > 0 && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
            <span>{multiSelect.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setMultiSelect(new Set())}>
              Done
            </Button>
          </div>
        )}
        {(reply || editing || file) && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-1 text-sm">
            <span className="truncate">
              {editing
                ? `Editing: ${editing.body}`
                : reply
                  ? `Replying: ${reply.body || "Attachment"}`
                  : file?.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel selection"
              onClick={() => {
                if (editing) setBody("");
                setEditing(null);
                setReply(null);
                setFile(null);
              }}
            >
              <X />
            </Button>
          </div>
        )}
        {stickersOpen && (
          <div
            className="mb-2 flex gap-2 overflow-x-auto rounded-xl bg-card p-3 text-3xl"
            role="dialog"
            aria-label="Emoji picker"
          >
            {["😀", "😂", "🥰", "❤️", "👍", "🎉", "😭", "🙏", "🔥", "👋", "✨", "💙"].map(
              (emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 text-2xl"
                  onClick={() => {
                    setBody((text) => text + emoji);
                    setStickersOpen(false);
                    emojiInput.current?.focus();
                  }}
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </Button>
              ),
            )}
          </div>
        )}
        {recording && (
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="shrink-0 font-mono tabular-nums" aria-label="Recording duration">
              {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
              {String(recordingSeconds % 60).padStart(2, "0")}
            </span>
            {recording === "voice" ? (
              <div
                className="flex h-8 min-w-0 flex-1 items-center gap-0.5"
                aria-label="Live audio waveform"
              >
                {waveform.map((amplitude, index) => (
                  <span
                    key={index}
                    className="min-w-0 flex-1 rounded-full bg-destructive"
                    style={{ height: `${Math.max(3, Math.round(amplitude * 26))}px` }}
                  />
                ))}
              </div>
            ) : (
              <span className="min-w-0 flex-1">Recording video note</span>
            )}
            {recordingLocked ? (
              <>
                <LockKeyhole className="h-4 w-4 shrink-0" aria-label="Recording locked" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel recording"
                  onClick={() => void cancelRecording()}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Send recording"
                  onClick={() => void stopRecording()}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <LockKeyholeOpen className="h-4 w-4 shrink-0" aria-label="Recording unlocked" />
            )}
          </div>
        )}
        {failedRecording && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1 truncate">Voice note was not sent</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retry voice note upload"
              disabled={retryingRecording}
              onClick={() =>
                void sendRecordedFile(
                  failedRecording.file,
                  failedRecording.kind,
                  failedRecording.duration,
                )
              }
            >
              {retryingRecording ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Discard unsent voice note"
              disabled={retryingRecording}
              onClick={() => setFailedRecording(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <form
          className="chat-composer liquid-crystal mx-3 mb-3 flex items-end gap-1 rounded-[26px] p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            type="file"
            className="hidden"
            ref={input}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > 25 * 1024 * 1024) toast.error("Choose a file smaller than 25 MB.");
              else setFile(f ?? null);
              e.target.value = "";
            }}
          />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={cameraInput}
            className="hidden"
            aria-label="Take a photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f?.size && f.size > 25 * 1024 * 1024)
                toast.error("Choose a photo smaller than 25 MB.");
              else if (f) setFile(f);
              e.target.value = "";
            }}
          />
          {attachmentSheet && (
            <div className="absolute bottom-full left-3 mb-2 flex gap-2 rounded-2xl border border-border bg-popover p-2 shadow-lg">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  input.current?.click();
                  setAttachmentSheet(false);
                }}
              >
                Photo or file
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  cameraInput.current?.click();
                  setAttachmentSheet(false);
                }}
              >
                Camera
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach photo or file"
            disabled={busy || !!editing || !ready || !!error}
            onClick={() => setAttachmentSheet((value) => !value)}
            className="chat-composer-icon h-10 w-10 shrink-0 rounded-full hover:bg-primary/10"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open emoji picker"
            onClick={() => setStickersOpen((value) => !value)}
            className="chat-composer-icon h-10 w-10 shrink-0 rounded-full hover:bg-primary/10"
          >
            <Smile className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Hold to record voice note"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              recordingGesture.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
              void startRecording("voice");
            }}
            onPointerMove={(event) => {
              const gesture = recordingGesture.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              if (event.clientX < gesture.x - 80) {
                recordingGesture.current = null;
                void cancelRecording();
              } else if (gesture.y - event.clientY > 80) {
                setRecordingLocked(true);
              }
            }}
            onPointerUp={() => {
              recordingGesture.current = null;
              if (!recordingLocked) void stopRecording();
            }}
            onPointerCancel={() => {
              recordingGesture.current = null;
              void cancelRecording();
            }}
            className="chat-composer-icon h-10 w-10 shrink-0 touch-none rounded-full hover:bg-primary/10"
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Take a photo"
            onClick={() => cameraInput.current?.click()}
            className="chat-composer-icon h-10 w-10 shrink-0 rounded-full hover:bg-primary/10"
          >
            <Camera className="h-4 w-4" />
          </Button>
          <textarea
            ref={emojiInput}
            aria-label="Message"
            placeholder="Message"
            rows={1}
            value={body}
            disabled={busy || !!error}
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            onChange={(e) => {
              setBody(e.target.value);
              if (user && Date.now() - lastTyping.current > 1500) {
                lastTyping.current = Date.now();
                void supabase.from("typing_status").upsert({
                  conversation_id: id,
                  user_id: user.id,
                  updated_at: new Date().toISOString(),
                });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="prism-send h-10 w-10 shrink-0 rounded-full bg-primary text-white hover:bg-primary/90"
            aria-label={editing ? "Save message" : "Send message"}
            disabled={busy || !ready || !!error || (!body.trim() && !file)}
          >
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </form>
      </footer>
      <BottomNav />
    </main>
  );
}
