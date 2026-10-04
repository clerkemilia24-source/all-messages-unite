// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Mic, MicOff, Radio, RefreshCw, Send, Video, VideoOff, X } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar } from "@/components/RemoteImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  createLiveStream,
  getLiveStreamToken,
  getLiveStreams,
  setLiveStreamStatus,
} from "@/lib/live.functions";
import type { Room as LiveKitRoom, RemoteTrack } from "livekit-client";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "LIVE — Ripple" },
      { name: "description", content: "Watch or start a live video broadcast." },
    ],
  }),
  component: LivePage,
});

type LiveSession = {
  id: string;
  host_id: string;
  title: string;
  status: string;
  created_at: string;
  started_at: string | null;
  host: { id: string; username: string; display_name: string; avatar_url: string | null } | null;
};

type LiveChatMessage = {
  id: string;
  stream_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function LivePage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [streams, setStreams] = useState<LiveSession[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [streamsError, setStreamsError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<LiveSession | null>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setStreamsLoading(true);
    setStreamsError(false);
    void getLiveStreams()
      .then((result) => {
        if (active) setStreams(result);
      })
      .catch(() => {
        if (active) setStreamsError(true);
      })
      .finally(() => {
        if (active) setStreamsLoading(false);
      });
    const channel = supabase
      .channel("live-discovery")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_streams" }, () => {
        setRefreshKey((key) => key + 1);
      })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user, refreshKey]);

  const closeSelected = useCallback(() => setSelected(null), []);

  async function startBroadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setStarting(true);
    try {
      const stream = await createLiveStream({ data: { title } });
      setSelected({
        ...stream,
        host_id: user.id,
        created_at: new Date().toISOString(),
        started_at: null,
        host: {
          id: user.id,
          username: profile?.username ?? "creator",
          display_name: profile?.display_name ?? "You",
          avatar_url: profile?.avatar_url ?? null,
        },
      });
      setTitle("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start LIVE.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-background text-foreground">
      {selected && user ? (
        <LiveRoom stream={selected} viewerId={user.id} onClose={closeSelected} />
      ) : (
        <>
          <header className="liquid-panel sticky top-0 z-10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-rose-500" />
              <h1 className="text-[2rem] font-bold">LIVE</h1>
            </div>
            <form onSubmit={(event) => void startBroadcast(event)} className="mt-3 flex gap-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What are you going live about?"
                aria-label="Broadcast title"
                minLength={2}
                maxLength={160}
                required
              />
              <Button type="submit" disabled={starting}>
                {starting ? <Loader2 className="animate-spin" /> : <Radio />}
                Go live
              </Button>
            </form>
          </header>

          <section className="flex-1 px-4 py-5">
            <h2 className="mb-3 text-lg font-semibold">Live now</h2>
            {streamsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : streamsError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">LIVE streams could not be loaded.</p>
                <Button variant="secondary" onClick={() => setRefreshKey((key) => key + 1)}>
                  <RefreshCw /> Retry
                </Button>
              </div>
            ) : streams.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No one is live right now.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {streams.map((stream) => (
                  <li key={stream.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(stream)}
                      className="flex w-full items-center gap-3 py-4 text-left"
                    >
                      <span className="relative">
                        <ChatAvatar
                          name={stream.host?.display_name ?? "Creator"}
                          path={stream.host?.avatar_url ?? null}
                          size={48}
                        />
                        <span className="absolute -bottom-1 -right-1 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          LIVE
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{stream.title}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {stream.host?.display_name ?? "Ripple creator"}
                        </span>
                      </span>
                      <Radio className="h-5 w-5 shrink-0 text-rose-500" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <BottomNav />
        </>
      )}
    </main>
  );
}

function LiveRoom({
  stream,
  viewerId,
  onClose,
}: {
  stream: LiveSession;
  viewerId: string;
  onClose: () => void;
}) {
  const isHost = stream.host_id === viewerId;
  const roomRef = useRef<LiveKitRoom | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteMediaRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState("Connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [roomRevision, setRoomRevision] = useState(0);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [chatError, setChatError] = useState(false);
  const [chatRevision, setChatRevision] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    let room: LiveKitRoom | null = null;
    const localVideo = localVideoRef.current;
    const remoteMedia = remoteMediaRef.current;
    setConnection("Connecting");
    setConnectionError(null);
    void (async () => {
      const credentials = await getLiveStreamToken({ data: { streamId: stream.id } });
      if (!active) return;
      const { Room, RoomEvent, Track } = await import("livekit-client");
      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const updateParticipantCount = () => {
        if (active) setParticipantCount(room?.remoteParticipants.size ?? 0);
      };
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        const element = track.attach();
        if (track.kind === Track.Kind.Video) {
          element.className = "h-full w-full object-contain";
          remoteMedia?.appendChild(element);
        } else {
          (element as HTMLAudioElement).autoplay = true;
          element.className = "hidden";
          remoteMedia?.appendChild(element);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((element) => element.remove());
      });
      room.on(RoomEvent.ParticipantConnected, updateParticipantCount);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipantCount);
      room.on(RoomEvent.Reconnecting, () => active && setConnection("Reconnecting"));
      room.on(RoomEvent.Reconnected, () => active && setConnection("Connected"));
      room.on(RoomEvent.Disconnected, () => active && setConnection("Disconnected"));

      try {
        await room.connect(credentials.url, credentials.token);
        updateParticipantCount();
        if (isHost) {
          await room.localParticipant.setCameraEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(true);
          const camera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
          if (camera && localVideo) camera.attach(localVideo);
          await setLiveStreamStatus({ data: { streamId: stream.id, status: "live" } });
          setCameraEnabled(true);
          setMicrophoneEnabled(true);
        }
        if (active) setConnection("Connected");
      } catch (error) {
        if (active) {
          setConnection("Disconnected");
          setConnectionError(error instanceof Error ? error.message : "Could not connect to LIVE.");
        }
        await room.disconnect();
      }
    })().catch((error) => {
      if (active) {
        setConnection("Disconnected");
        setConnectionError(error instanceof Error ? error.message : "Could not connect to LIVE.");
      }
    });
    return () => {
      active = false;
      if (roomRef.current === room) roomRef.current = null;
      if (room) void room.disconnect();
      if (localVideo) localVideo.srcObject = null;
      if (remoteMedia) remoteMedia.replaceChildren();
    };
  }, [stream.id, isHost, roomRevision]);

  useEffect(() => {
    let active = true;
    setChatError(false);
    void (async () => {
      const { data, error } = await supabase
        .from("live_chat_messages")
        .select("id, stream_id, sender_id, body, created_at")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      if (active) setMessages((data ?? []).reverse());
    })().catch(() => {
      if (active) setChatError(true);
    });
    const channel = supabase
      .channel(`live-chat-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_chat_messages",
          filter: `stream_id=eq.${stream.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const message = payload.new as LiveChatMessage;
            setMessages((current) =>
              [...current.filter((item) => item.id !== message.id), message].slice(-50),
            );
          } else if (payload.eventType === "DELETE") {
            const removed = payload.old as Partial<LiveChatMessage>;
            if (removed.id)
              setMessages((current) => current.filter((item) => item.id !== removed.id));
          }
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [stream.id, chatRevision]);

  useEffect(() => {
    if (isHost) return;
    const channel = supabase
      .channel(`live-lifecycle-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "live_streams",
          filter: `id=eq.${stream.id}`,
        },
        (payload) => {
          if ((payload.new as { status?: string }).status === "ended") onClose();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [stream.id, isHost, onClose]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const { error } = await supabase
      .from("live_chat_messages")
      .insert({ stream_id: stream.id, sender_id: viewerId, body });
    setSending(false);
    if (error) {
      toast.error("Chat message could not be sent.");
      return;
    }
    setDraft("");
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room) return;
    try {
      const next = !cameraEnabled;
      await room.localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      if (next && localVideoRef.current) {
        const { Track } = await import("livekit-client");
        room.localParticipant
          .getTrackPublication(Track.Source.Camera)
          ?.track?.attach(localVideoRef.current);
      }
    } catch {
      toast.error("Camera control failed.");
    }
  }

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room) return;
    try {
      const next = !microphoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicrophoneEnabled(next);
    } catch {
      toast.error("Microphone control failed.");
    }
  }

  async function leaveOrEnd() {
    if (isHost) {
      try {
        await setLiveStreamStatus({ data: { streamId: stream.id, status: "ended" } });
      } catch {
        toast.error("The broadcast could not be ended. Check your connection and retry.");
        return;
      }
    }
    await roomRef.current?.disconnect();
    onClose();
  }

  return (
    <section className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-600">
          <Radio className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{stream.title}</span>
          <span className="text-xs text-white/70">
            {connection} · {participantCount} connected viewers
          </span>
        </span>
        {!isHost && (
          <button onClick={() => void leaveOrEnd()} aria-label="Leave live stream">
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-black">
        {isHost ? (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <div ref={remoteMediaRef} className="absolute inset-0 grid place-items-center">
            <div className="pointer-events-none absolute z-0 text-center text-white/75">
              {connection === "Connecting" ? (
                <Loader2 className="mx-auto h-7 w-7 animate-spin" />
              ) : (
                <p>{connectionError ?? "Waiting for the host video..."}</p>
              )}
            </div>
          </div>
        )}
        {isHost && connectionError && (
          <div className="absolute inset-x-4 bottom-4 flex flex-col items-center gap-3 rounded-lg bg-black/75 p-4 text-center">
            <p className="text-sm">{connectionError}</p>
            <Button variant="secondary" onClick={() => setRoomRevision((revision) => revision + 1)}>
              <RefreshCw /> Reconnect
            </Button>
          </div>
        )}
      </div>

      <div className="flex h-[34dvh] min-h-48 flex-col border-t border-white/15">
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
          {chatError ? (
            <button
              type="button"
              onClick={() => setChatRevision((revision) => revision + 1)}
              className="text-sm underline"
            >
              Chat could not load. Retry
            </button>
          ) : (
            messages.map((message) => (
              <p key={message.id} className="break-words text-sm">
                <span className="mr-2 font-semibold">
                  {message.sender_id === stream.host_id
                    ? "Host"
                    : message.sender_id === viewerId
                      ? "You"
                      : "Viewer"}
                </span>
                {message.body}
              </p>
            ))
          )}
        </div>
        <form
          onSubmit={(event) => void sendMessage(event)}
          className="flex gap-2 border-t border-white/15 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            placeholder="Say something"
            aria-label="Live chat message"
            className="border-white/20 bg-white/10 text-white placeholder:text-white/55"
          />
          <Button type="submit" size="icon" variant="secondary" disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="sr-only">Send chat message</span>
          </Button>
        </form>
        {isHost && (
          <div className="flex justify-center gap-3 px-3 pb-3">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void toggleCamera()}
              aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
            >
              {cameraEnabled ? <Video /> : <VideoOff />}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void toggleMicrophone()}
              aria-label={microphoneEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {microphoneEnabled ? <Mic /> : <MicOff />}
            </Button>
            <Button variant="destructive" onClick={() => void leaveOrEnd()}>
              End broadcast
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
