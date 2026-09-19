import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Room, RemoteTrack, LocalTrack } from "livekit-client";
import { toast } from "sonner";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getCallToken } from "@/lib/calls.functions";
import { ChatAvatar } from "@/components/RemoteImage";

export type CallKind = "audio" | "video";

export type CallRow = {
  id: string;
  conversation_id: string;
  room_name: string;
  initiator_id: string;
  kind: CallKind;
  status: "ringing" | "accepted" | "declined" | "missed" | "ended";
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

type CallState = {
  call: CallRow;
  role: "caller" | "callee";
  peerName: string;
  peerAvatar: string | null;
  connected: boolean;
};

type CallsValue = {
  active: CallState | null;
  startCall: (conversationId: string, kind: CallKind, peerName: string) => Promise<void>;
};

const CallsContext = createContext<CallsValue>({ active: null, startCall: async () => {} });
export const useCalls = () => useContext(CallsContext);

const RING_TIMEOUT_MS = 45_000;

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [active, setActive] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const remoteMedia = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(async () => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    if (remoteMedia.current) remoteMedia.current.innerHTML = "";
    setMuted(false);
    setCameraOff(false);
    setActive(null);
  }, []);

  const connect = useCallback(
    async (call: CallRow) => {
      const { token, url } = await getCallToken({ data: { callId: call.id } });
      const { Room: LKRoom, RoomEvent, Track } = await import("livekit-client");
      const room = new LKRoom({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
          const el = track.attach();
          if (track.kind === Track.Kind.Video) {
            el.className = "h-full w-full rounded-2xl object-cover";
          } else {
            (el as HTMLAudioElement).autoplay = true;
          }
          remoteMedia.current?.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        void teardown();
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (call.kind === "video") {
        await room.localParticipant.setCameraEnabled(true);
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track as LocalTrack | undefined;
        if (track && localVideo.current) track.attach(localVideo.current);
      }
      setActive((s) => (s && s.call.id === call.id ? { ...s, connected: true } : s));
    },
    [teardown],
  );

  const endCall = useCallback(
    async (status: "ended" | "declined" | "missed") => {
      const current = active;
      await teardown();
      if (!current) return;
      await supabase
        .from("call_sessions")
        .update({ status, ended_at: new Date().toISOString() })
        .eq("id", current.call.id)
        .in("status", ["ringing", "accepted"]);
    },
    [active, teardown],
  );

  const startCall = useCallback(
    async (conversationId: string, kind: CallKind, peerName: string) => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from("call_sessions")
          .insert({
            conversation_id: conversationId,
            initiator_id: user.id,
            kind,
            room_name: `call_${crypto.randomUUID()}`,
          })
          .select("*")
          .single();
        if (error || !data) throw error ?? new Error("no call");
        const call = data as CallRow;
        setActive({ call, role: "caller", peerName, peerAvatar: null, connected: false });
        await connect(call);
        ringTimer.current = setTimeout(() => {
          void supabase
            .from("call_sessions")
            .update({ status: "missed", ended_at: new Date().toISOString() })
            .eq("id", call.id)
            .eq("status", "ringing")
            .then(() => teardown());
        }, RING_TIMEOUT_MS);
      } catch {
        toast.error("The call could not be started. Check your microphone permission.");
        await teardown();
      }
    },
    [user, connect, teardown],
  );

  // Incoming calls: row-level security only exposes calls in my conversations.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("calls")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_sessions" },
        async (payload) => {
          const call = payload.new as CallRow;
          if (call.initiator_id === user.id || call.status !== "ringing") return;
          const { data: caller } = await supabase
            .from("profiles")
            .select("display_name, avatar_url")
            .eq("id", call.initiator_id)
            .maybeSingle();
          setActive((existing) =>
            existing
              ? existing
              : {
                  call,
                  role: "callee",
                  peerName: caller?.display_name ?? "Unknown",
                  peerAvatar: caller?.avatar_url ?? null,
                  connected: false,
                },
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "call_sessions" },
        (payload) => {
          const call = payload.new as CallRow;
          setActive((existing) => {
            if (!existing || existing.call.id !== call.id) return existing;
            if (["ended", "declined", "missed"].includes(call.status)) {
              void teardown();
              toast(call.status === "declined" ? "Call declined" : "Call ended");
              return null;
            }
            return { ...existing, call };
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, teardown]);

  async function accept() {
    if (!active) return;
    try {
      await supabase
        .from("call_sessions")
        .update({ status: "accepted", answered_at: new Date().toISOString() })
        .eq("id", active.call.id);
      await connect(active.call);
    } catch {
      toast.error("Could not join the call.");
      await endCall("ended");
    }
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOff;
    await room.localParticipant.setCameraEnabled(!next);
    setCameraOff(next);
  }

  const ringingIncoming = active?.role === "callee" && active.call.status === "ringing";

  return (
    <CallsContext.Provider value={{ active, startCall }}>
      {children}
      {active && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-foreground/95 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-background">
          <div className="flex flex-col items-center gap-3">
            <ChatAvatar name={active.peerName} path={active.peerAvatar} size={88} />
            <h2 className="text-2xl font-semibold">{active.peerName}</h2>
            <p className="text-sm opacity-80">
              {ringingIncoming
                ? `Incoming ${active.call.kind} call`
                : active.connected && active.call.status === "accepted"
                  ? "Connected"
                  : active.connected
                    ? "Ringing…"
                    : "Connecting…"}
            </p>
          </div>

          <div className="relative w-full flex-1 py-4">
            <div ref={remoteMedia} className="h-full w-full [&>video]:h-full [&>video]:w-full" />
            {active.call.kind === "video" && (
              <video
                ref={localVideo}
                muted
                autoPlay
                playsInline
                className="absolute bottom-4 right-2 h-32 w-24 rounded-xl object-cover"
              />
            )}
          </div>

          <div className="flex items-center gap-4">
            {ringingIncoming ? (
              <>
                <button
                  onClick={() => void endCall("declined")}
                  aria-label="Decline call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <PhoneOff />
                </button>
                <button
                  onClick={() => void accept()}
                  aria-label="Accept call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-presence text-background"
                >
                  <Phone />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => void toggleMute()}
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-background/20"
                >
                  {muted ? <MicOff /> : <Mic />}
                </button>
                {active.call.kind === "video" && (
                  <button
                    onClick={() => void toggleCamera()}
                    aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-background/20"
                  >
                    {cameraOff ? <VideoOff /> : <Video />}
                  </button>
                )}
                <button
                  onClick={() => void endCall("ended")}
                  aria-label="End call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <PhoneOff />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </CallsContext.Provider>
  );
}
