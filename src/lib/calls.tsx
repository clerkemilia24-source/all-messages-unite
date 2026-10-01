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
import {
  Hand,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  PictureInPicture2,
  ScreenShare,
  Smile,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getCallToken, reportCallIceCandidate, setCallCohost } from "@/lib/calls.functions";
import { ChatAvatar } from "@/components/RemoteImage";

export type CallKind = "audio" | "video";
type CallRole = "host" | "cohost" | "participant";
type CallLayout = "gallery" | "speaker" | "sidebar";

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
  role: CallRole;
  incoming: boolean;
  isGroup: boolean;
  peerName: string;
  peerAvatar: string | null;
  connected: boolean;
};

type CallPerson = {
  id: string;
  name: string;
  avatar: string | null;
  role: CallRole;
};

type InCallMessage = { senderId: string; text: string; sentAt: number };

type CallsValue = {
  active: CallState | null;
  startCall: (conversationId: string, kind: CallKind, peerName: string) => Promise<void>;
};

const CallsContext = createContext<CallsValue>({ active: null, startCall: async () => {} });
export const useCalls = () => useContext(CallsContext);

const RING_TIMEOUT_MS = 45_000;
type IceCandidateType = "host" | "srflx" | "relay" | "unknown";

function getSelectedIceCandidateTypes(report: RTCStatsReport) {
  const stats = Array.from(report.values()) as Array<Record<string, unknown>>;
  const selectedPairId = stats.find(
    (entry) =>
      entry["type"] === "transport" && typeof entry["selectedCandidatePairId"] === "string",
  )?.["selectedCandidatePairId"];
  const selectedPair =
    stats.find((entry) => entry["id"] === selectedPairId) ??
    stats.find(
      (entry) =>
        entry["type"] === "candidate-pair" &&
        (entry["selected"] === true ||
          (entry["nominated"] === true && entry["state"] === "succeeded")),
    );
  if (!selectedPair) return undefined;

  const getCandidateType = (candidateId: unknown): IceCandidateType => {
    const candidate = stats.find((entry) => entry["id"] === candidateId);
    const type = candidate?.["candidateType"];
    return type === "host" || type === "srflx" || type === "relay" ? type : "unknown";
  };

  return {
    localCandidateType: getCandidateType(selectedPair["localCandidateId"]),
    remoteCandidateType: getCandidateType(selectedPair["remoteCandidateId"]),
  };
}

async function reportSelectedIceCandidate(room: Room, callId: string) {
  try {
    for (const publication of room.localParticipant.trackPublications.values()) {
      const report = await publication.track?.getRTCStatsReport();
      const candidateTypes = report && getSelectedIceCandidateTypes(report);
      if (!candidateTypes) continue;
      await reportCallIceCandidate({ data: { callId, ...candidateTypes } });
      return;
    }
  } catch (error) {
    console.warn("[calls] Could not report selected ICE candidate pair", error);
  }
}

class CallMediaError extends Error {
  readonly kind: CallKind;
  readonly originalError: unknown;

  constructor(kind: CallKind, originalError: unknown) {
    super("Call media access failed");
    this.kind = kind;
    this.originalError = originalError;
    this.name = "CallMediaError";
  }
}

function isPermissionDenied(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(String(error.name))
  );
}

async function requestCallMedia(kind: CallKind) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CallMediaError(kind, new Error("Media devices are unavailable."));
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video",
    });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    throw new CallMediaError(kind, error);
  }
}

function callErrorMessage(error: unknown) {
  if (error instanceof CallMediaError) {
    if (isPermissionDenied(error.originalError)) {
      return error.kind === "video"
        ? "Microphone and camera access is blocked. Allow both in your browser settings, then try again."
        : "Microphone access is blocked. Allow it in your browser settings, then try again.";
    }
    if (
      typeof error.originalError === "object" &&
      error.originalError !== null &&
      "name" in error.originalError &&
      String(error.originalError.name) === "NotFoundError"
    ) {
      return error.kind === "video"
        ? "No microphone or camera was found. Connect a device, then try again."
        : "No microphone was found. Connect one, then try again.";
    }
  }
  return "The call could not be connected. Please try again.";
}

function logLiveKitConnectionError(error: unknown, url: string) {
  const details =
    typeof error === "object" && error !== null
      ? {
          name: "name" in error ? error.name : undefined,
          code: "code" in error ? error.code : undefined,
          message: "message" in error ? error.message : undefined,
          reason: "reason" in error ? error.reason : undefined,
          cause: "cause" in error ? error.cause : undefined,
        }
      : { value: error };
  console.error("[calls] LiveKit room.connect failed", {
    url,
    protocol: (() => {
      try {
        return new URL(url).protocol;
      } catch {
        return "invalid";
      }
    })(),
    ...details,
    error,
  });
}

function logTokenRequestError(error: unknown) {
  if (error instanceof Response) {
    console.error("[calls] LiveKit token request failed", {
      status: error.status,
      statusText: error.statusText,
      url: error.url,
    });
    return;
  }
  const details =
    typeof error === "object" && error !== null
      ? {
          name: "name" in error ? error.name : undefined,
          message: "message" in error ? error.message : undefined,
          status: "status" in error ? error.status : undefined,
          cause: "cause" in error ? error.cause : undefined,
        }
      : { value: error };
  console.error("[calls] LiveKit token request failed", details);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [active, setActive] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [layout, setLayout] = useState<CallLayout>("gallery");
  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<CallPerson[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<InCallMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const roomRef = useRef<Room | null>(null);
  const remoteMedia = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const participantNames = useRef(new Map<string, string>());
  const speakerIdentity = useRef<string | null>(null);

  const loadCallParticipants = useCallback(async (call: CallRow) => {
    const [{ data: members }, { data: cohosts }] = await Promise.all([
      supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", call.conversation_id),
      supabase.from("call_cohosts").select("user_id").eq("call_id", call.id),
    ]);
    const memberIds = (members ?? []).map((member) => member.user_id);
    if (!memberIds.length) {
      setParticipants([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", memberIds);
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const cohostIds = new Set((cohosts ?? []).map((cohost) => cohost.user_id));
    const nextParticipants = memberIds.map((id) => {
      const profile = profileMap.get(id);
      return {
        id,
        name: profile?.display_name ?? "Participant",
        avatar: profile?.avatar_url ?? null,
        role: id === call.initiator_id ? "host" : cohostIds.has(id) ? "cohost" : "participant",
      } satisfies CallPerson;
    });
    participantNames.current = new Map(nextParticipants.map((person) => [person.id, person.name]));
    setParticipants(nextParticipants);
  }, []);

  const activeCall = active?.call;
  useEffect(() => {
    if (!activeCall) return;
    void loadCallParticipants(activeCall);
    const channel = supabase
      .channel(`call-cohosts-${activeCall.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_cohosts",
          filter: `call_id=eq.${activeCall.id}`,
        },
        () => void loadCallParticipants(activeCall),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeCall, loadCallParticipants]);

  const teardown = useCallback(async () => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    if (remoteMedia.current) remoteMedia.current.innerHTML = "";
    setMuted(false);
    setCameraOff(false);
    setSharingScreen(false);
    setMinimized(false);
    setParticipants([]);
    setConnectedIds([]);
    setRaisedHands([]);
    setReactions({});
    setMessages([]);
    setShowParticipants(false);
    setShowChat(false);
    setSpeakerId(null);
    speakerIdentity.current = null;
    setActive(null);
  }, []);

  const connect = useCallback(
    async (call: CallRow) => {
      let token: string;
      let url: string;
      let role: CallRole;
      try {
        ({ token, url, role } = await getCallToken({ data: { callId: call.id } }));
      } catch (error) {
        logTokenRequestError(error);
        throw error;
      }
      const { Room: LKRoom, RoomEvent, Track } = await import("livekit-client");
      const room = new LKRoom({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
        if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
          const el = track.attach();
          if (track.kind === Track.Kind.Video) {
            const tile = document.createElement("div");
            tile.dataset["callTrack"] = track.sid;
            tile.dataset["speaker"] =
              participant.identity === speakerIdentity.current ? "true" : "false";
            tile.className = "relative min-h-0 overflow-hidden rounded-xl bg-black/40";
            el.className = "h-full w-full object-cover";
            const label = document.createElement("span");
            label.className =
              "absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white";
            label.textContent =
              participantNames.current.get(participant.identity) ??
              participant.identity.slice(0, 8);
            tile.append(el, label);
            remoteMedia.current?.appendChild(tile);
          } else {
            (el as HTMLAudioElement).autoplay = true;
            el.className = "hidden";
            remoteMedia.current?.appendChild(el);
          }
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => {
          const tile = el.parentElement;
          el.remove();
          if (tile && tile.dataset["callTrack"] === track.sid) tile.remove();
        });
      });
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        setConnectedIds((ids) => Array.from(new Set([...ids, participant.identity])));
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setConnectedIds((ids) => ids.filter((id) => id !== participant.identity));
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const identity =
          speakers.find((participant) => participant.identity !== room.localParticipant.identity)
            ?.identity ?? null;
        speakerIdentity.current = identity;
        setSpeakerId(identity);
        const tiles = remoteMedia.current?.querySelectorAll<HTMLElement>("[data-call-track]");
        tiles?.forEach((tile) => {
          tile.dataset["speaker"] = tile.dataset["callTrack"] === identity ? "true" : "false";
        });
        const mainTile = remoteMedia.current?.querySelector<HTMLElement>('[data-speaker="true"]');
        if (mainTile) remoteMedia.current?.prepend(mainTile);
      });
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (!participant || topic !== "call") return;
        try {
          const packet = JSON.parse(new TextDecoder().decode(payload)) as {
            type?: unknown;
            text?: unknown;
            emoji?: unknown;
            raised?: unknown;
          };
          if (packet.type === "chat" && typeof packet.text === "string") {
            const text = packet.text.trim().slice(0, 1000);
            if (text) {
              setMessages((items) => [
                ...items.slice(-99),
                { senderId: participant.identity, text, sentAt: Date.now() },
              ]);
            }
          } else if (packet.type === "hand" && typeof packet.raised === "boolean") {
            setRaisedHands((ids) =>
              packet.raised
                ? Array.from(new Set([...ids, participant.identity]))
                : ids.filter((id) => id !== participant.identity),
            );
          } else if (
            packet.type === "reaction" &&
            typeof packet.emoji === "string" &&
            ["❤️", "👏", "😂", "👍", "🎉"].includes(packet.emoji)
          ) {
            setReactions((current) => ({
              ...current,
              [participant.identity]: packet.emoji as string,
            }));
            window.setTimeout(() => {
              setReactions((current) => {
                if (current[participant.identity] !== packet.emoji) return current;
                const next = { ...current };
                delete next[participant.identity];
                return next;
              });
            }, 2500);
          }
        } catch {
          console.warn("[calls] Ignored malformed in-call data");
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        void teardown();
      });

      try {
        await room.connect(url, token);
      } catch (error) {
        logLiveKitConnectionError(error, url);
        throw error;
      }
      setConnectedIds([
        room.localParticipant.identity,
        ...Array.from(room.remoteParticipants.values()).map((participant) => participant.identity),
      ]);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (call.kind === "video") {
        await room.localParticipant.setCameraEnabled(true);
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track as LocalTrack | undefined;
        if (track && localVideo.current) track.attach(localVideo.current);
      }
      window.setTimeout(() => {
        if (roomRef.current === room) void reportSelectedIceCandidate(room, call.id);
      }, 1000);
      setActive((s) =>
        s && s.call.id === call.id ? { ...s, role, incoming: false, connected: true } : s,
      );
    },
    [teardown],
  );

  const endCall = useCallback(
    async (status: "ended" | "declined" | "missed") => {
      const current = active;
      await teardown();
      if (!current || (current.isGroup && current.role !== "host")) return;
      await supabase
        .from("call_sessions")
        .update({
          status: current.isGroup && status !== "missed" ? "ended" : status,
          ended_at: new Date().toISOString(),
        })
        .eq("id", current.call.id)
        .in("status", ["ringing", "accepted"]);
    },
    [active, teardown],
  );

  async function sendCallData(packet: Record<string, string | boolean>) {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(packet)), {
      reliable: true,
      topic: "call",
    });
  }

  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!sharingScreen);
      setSharingScreen(!sharingScreen);
    } catch (error) {
      console.error("[calls] Screen sharing failed", error);
      toast.error("Screen sharing could not be started.");
    }
  }

  async function toggleRaiseHand() {
    if (!user) return;
    const raised = !raisedHands.includes(user.id);
    setRaisedHands((ids) =>
      raised ? Array.from(new Set([...ids, user.id])) : ids.filter((id) => id !== user.id),
    );
    try {
      await sendCallData({ type: "hand", raised });
    } catch (error) {
      console.error("[calls] Raise-hand event failed", error);
      toast.error("Could not update your raised hand.");
    }
  }

  async function sendReaction(emoji: string) {
    try {
      await sendCallData({ type: "reaction", emoji });
      if (user) {
        setReactions((current) => ({ ...current, [user.id]: emoji }));
        window.setTimeout(() => {
          setReactions((current) => {
            if (current[user.id] !== emoji) return current;
            const next = { ...current };
            delete next[user.id];
            return next;
          });
        }, 2500);
      }
    } catch (error) {
      console.error("[calls] Reaction failed", error);
      toast.error("Could not send your reaction.");
    }
  }

  async function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatDraft.trim().slice(0, 1000);
    if (!user || !text) return;
    try {
      await sendCallData({ type: "chat", text });
      setMessages((items) => [
        ...items.slice(-99),
        { senderId: user.id, text, sentAt: Date.now() },
      ]);
      setChatDraft("");
    } catch (error) {
      console.error("[calls] In-call message failed", error);
      toast.error("Could not send your message.");
    }
  }

  async function togglePictureInPicture() {
    const video = localVideo.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (error) {
      console.error("[calls] Picture-in-picture failed", error);
      toast.error("Picture-in-picture is unavailable in this browser.");
    }
  }

  async function changeCohost(person: CallPerson) {
    if (!active) return;
    try {
      await setCallCohost({
        data: { callId: active.call.id, userId: person.id, isCohost: person.role !== "cohost" },
      });
      await loadCallParticipants(active.call);
    } catch (error) {
      console.error("[calls] Co-host update failed", error);
      toast.error("Only the call host can change co-host roles.");
    }
  }

  const startCall = useCallback(
    async (conversationId: string, kind: CallKind, peerName: string) => {
      if (!user) return;
      try {
        await requestCallMedia(kind);
        const { data: conversation } = await supabase
          .from("conversations")
          .select("is_group")
          .eq("id", conversationId)
          .maybeSingle();
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
        setActive({
          call,
          role: "participant",
          incoming: false,
          isGroup: conversation?.is_group ?? false,
          peerName,
          peerAvatar: null,
          connected: false,
        });
        ringTimer.current = setTimeout(() => {
          void supabase
            .from("call_sessions")
            .update({ status: "missed", ended_at: new Date().toISOString() })
            .eq("id", call.id)
            .eq("status", "ringing")
            .then(() => teardown());
        }, RING_TIMEOUT_MS);
        await connect(call);
      } catch (error) {
        console.error("[calls] Outgoing call failed", error);
        toast.error(callErrorMessage(error));
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
          const [{ data: caller }, { data: conversation }] = await Promise.all([
            supabase
              .from("profiles")
              .select("display_name, avatar_url")
              .eq("id", call.initiator_id)
              .maybeSingle(),
            supabase
              .from("conversations")
              .select("is_group")
              .eq("id", call.conversation_id)
              .maybeSingle(),
          ]);
          setActive((existing) =>
            existing
              ? existing
              : {
                  call,
                  role: "participant",
                  incoming: true,
                  isGroup: conversation?.is_group ?? false,
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
          if (call.status === "accepted" && ringTimer.current) {
            clearTimeout(ringTimer.current);
            ringTimer.current = null;
          }
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
      await requestCallMedia(active.call.kind);
      await supabase
        .from("call_sessions")
        .update({ status: "accepted", answered_at: new Date().toISOString() })
        .eq("id", active.call.id);
      await connect(active.call);
    } catch (error) {
      console.error("[calls] Incoming call failed", error);
      toast.error(
        error instanceof CallMediaError ? callErrorMessage(error) : "Could not join the call.",
      );
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

  const ringingIncoming = active?.incoming === true && !active.connected;

  return (
    <CallsContext.Provider value={{ active, startCall }}>
      {children}
      {active &&
        (minimized ? (
          <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-border bg-foreground px-4 py-3 text-background shadow-xl">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {active.peerName} · {connectedIds.length} in call
            </span>
            <button
              onClick={() => setMinimized(false)}
              title="Restore call"
              aria-label="Restore call"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
            <button onClick={() => void endCall("ended")} title="End call" aria-label="End call">
              <PhoneOff className="h-5 w-5 text-destructive" />
            </button>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex flex-col bg-foreground text-background">
            <header className="flex min-h-16 items-center justify-between gap-3 border-b border-background/15 px-4 pt-[env(safe-area-inset-top)]">
              <div className="flex min-w-0 items-center gap-3">
                <ChatAvatar name={active.peerName} path={active.peerAvatar} size={40} />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">
                    {active.isGroup ? `${active.peerName} group call` : active.peerName}
                  </h2>
                  <p className="text-xs opacity-75">
                    {ringingIncoming
                      ? `Incoming ${active.call.kind} call`
                      : active.connected
                        ? `${connectedIds.length} in call · ${active.role}`
                        : "Connecting…"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowParticipants((shown) => !shown)}
                  title="Participants"
                  aria-label="Participants"
                  className={`rounded-lg p-2 ${showParticipants ? "bg-background/20" : ""}`}
                >
                  <Users className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowChat((shown) => !shown)}
                  title="In-call chat"
                  aria-label="In-call chat"
                  className={`rounded-lg p-2 ${showChat ? "bg-background/20" : ""}`}
                >
                  <MessageSquare className="h-5 w-5" />
                </button>
                {active.call.kind === "video" && document.pictureInPictureEnabled && (
                  <button
                    onClick={() => void togglePictureInPicture()}
                    title="Picture in picture"
                    aria-label="Picture in picture"
                    className="rounded-lg p-2"
                  >
                    <PictureInPicture2 className="h-5 w-5" />
                  </button>
                )}
                <button
                  onClick={() => setMinimized(true)}
                  title="Minimize call"
                  aria-label="Minimize call"
                  className="rounded-lg p-2"
                >
                  <Minimize2 className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <main className="relative flex min-w-0 flex-1 flex-col">
                <div
                  className="flex items-center justify-center gap-1 px-3 py-2"
                  role="group"
                  aria-label="Call layout"
                >
                  {(["gallery", "speaker", "sidebar"] as const).map((view) => (
                    <button
                      key={view}
                      onClick={() => setLayout(view)}
                      aria-pressed={layout === view}
                      className={`rounded-md px-3 py-1.5 text-xs capitalize ${layout === view ? "bg-background/20" : "opacity-70"}`}
                    >
                      {view}
                    </button>
                  ))}
                </div>
                <div
                  ref={remoteMedia}
                  className={`relative grid min-h-0 flex-1 content-center gap-2 overflow-hidden p-2 ${
                    layout === "gallery"
                      ? "grid-cols-2 auto-rows-fr"
                      : layout === "speaker"
                        ? speakerId
                          ? "grid-cols-1 grid-rows-1 [&>[data-call-track]:not([data-speaker=true])]:hidden"
                          : "grid-cols-1 grid-rows-1 [&>[data-call-track]:not(:first-child)]:hidden"
                        : "grid-cols-[minmax(0,1fr)_7rem] auto-rows-fr [&>[data-call-track]:first-child]:row-span-full"
                  }`}
                />
                {active.call.kind === "video" && (
                  <video
                    ref={localVideo}
                    muted
                    autoPlay
                    playsInline
                    className="absolute bottom-4 right-4 z-10 h-28 w-20 rounded-lg bg-black object-cover shadow-lg"
                  />
                )}
                {Object.entries(reactions).length > 0 && (
                  <div className="absolute left-4 top-4 flex gap-2">
                    {Object.entries(reactions).map(([id, emoji]) => (
                      <span key={id} className="rounded-full bg-background/15 px-3 py-2 text-xl">
                        {emoji}
                      </span>
                    ))}
                  </div>
                )}
              </main>

              {(showParticipants || showChat) && (
                <aside className="flex w-[min(22rem,42vw)] min-w-64 flex-col border-l border-background/15 bg-background/5">
                  <div className="flex border-b border-background/15">
                    <button
                      onClick={() => {
                        setShowParticipants(true);
                        setShowChat(false);
                      }}
                      className={`flex-1 px-3 py-3 text-sm ${showParticipants ? "font-semibold" : "opacity-65"}`}
                    >
                      Participants ({connectedIds.length})
                    </button>
                    <button
                      onClick={() => {
                        setShowParticipants(false);
                        setShowChat(true);
                      }}
                      className={`flex-1 px-3 py-3 text-sm ${showChat ? "font-semibold" : "opacity-65"}`}
                    >
                      Chat
                    </button>
                  </div>
                  {showParticipants ? (
                    <ul className="min-h-0 flex-1 divide-y divide-background/10 overflow-y-auto">
                      {participants.map((person) => (
                        <li key={person.id} className="flex items-center gap-2 px-3 py-3">
                          <ChatAvatar name={person.name} path={person.avatar} size={34} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {person.name}
                              {person.id === user?.id ? " (you)" : ""}
                            </p>
                            <p className="text-xs capitalize opacity-65">
                              {raisedHands.includes(person.id) ? "✋ · " : ""}
                              {connectedIds.includes(person.id) ? "In call · " : "Invited · "}
                              {person.role}
                            </p>
                          </div>
                          {active.role === "host" && person.id !== active.call.initiator_id && (
                            <button
                              onClick={() => void changeCohost(person)}
                              className="text-xs text-background/80 underline underline-offset-2"
                            >
                              {person.role === "cohost" ? "Remove co-host" : "Make co-host"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <div
                        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
                        aria-live="polite"
                      >
                        {messages.map((message, index) => (
                          <p key={`${message.sentAt}-${index}`} className="break-words text-sm">
                            <span className="font-semibold">
                              {message.senderId === user?.id
                                ? "You"
                                : (participants.find((person) => person.id === message.senderId)
                                    ?.name ?? "Participant")}
                              :{" "}
                            </span>
                            {message.text}
                          </p>
                        ))}
                      </div>
                      <form
                        onSubmit={(event) => void sendChatMessage(event)}
                        className="flex gap-2 border-t border-background/15 p-3"
                      >
                        <input
                          value={chatDraft}
                          onChange={(event) => setChatDraft(event.target.value)}
                          maxLength={1000}
                          aria-label="In-call message"
                          placeholder="Message the call"
                          className="min-w-0 flex-1 rounded-md bg-background/10 px-3 py-2 text-sm outline-none placeholder:text-background/50"
                        />
                        <button
                          type="submit"
                          disabled={!chatDraft.trim()}
                          aria-label="Send message"
                          title="Send message"
                        >
                          <MessageSquare className="h-5 w-5" />
                        </button>
                      </form>
                    </>
                  )}
                </aside>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-background/15 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              {!ringingIncoming ? (
                <>
                  <button
                    onClick={() => void toggleMute()}
                    aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                    title={muted ? "Unmute microphone" : "Mute microphone"}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-background/15"
                  >
                    {muted ? <MicOff /> : <Mic />}
                  </button>
                  {active.call.kind === "video" && (
                    <button
                      onClick={() => void toggleCamera()}
                      aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                      title={cameraOff ? "Turn camera on" : "Turn camera off"}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-background/15"
                    >
                      {cameraOff ? <VideoOff /> : <Video />}
                    </button>
                  )}
                  <button
                    onClick={() => void toggleScreenShare()}
                    aria-label={sharingScreen ? "Stop sharing screen" : "Share screen"}
                    title={sharingScreen ? "Stop sharing screen" : "Share screen"}
                    className={`flex h-12 w-12 items-center justify-center rounded-full ${sharingScreen ? "bg-presence text-background" : "bg-background/15"}`}
                  >
                    <ScreenShare />
                  </button>
                  <button
                    onClick={() => void toggleRaiseHand()}
                    aria-label={raisedHands.includes(user?.id ?? "") ? "Lower hand" : "Raise hand"}
                    title={raisedHands.includes(user?.id ?? "") ? "Lower hand" : "Raise hand"}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-background/15"
                  >
                    <Hand />
                  </button>
                  <div
                    className="flex items-center gap-1 rounded-full bg-background/10 px-2 py-1"
                    aria-label="Reactions"
                  >
                    {(
                      [
                        ["❤️", "Heart"],
                        ["👏", "Clap"],
                        ["😂", "Laugh"],
                        ["👍", "Like"],
                      ] as const
                    ).map(([emoji, label]) => (
                      <button
                        key={emoji}
                        onClick={() => void sendReaction(emoji)}
                        title={label}
                        aria-label={`${label} reaction`}
                        className="p-1 text-lg"
                      >
                        {emoji}
                      </button>
                    ))}
                    <Smile className="ml-1 h-4 w-4 opacity-60" aria-hidden="true" />
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void endCall("declined")}
                    aria-label="Decline call"
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  >
                    <PhoneOff />
                  </button>
                  <button
                    onClick={() => void accept()}
                    aria-label="Accept call"
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-presence text-background"
                  >
                    <Phone />
                  </button>
                </>
              )}
              {!ringingIncoming && (
                <button
                  onClick={() => void endCall("ended")}
                  aria-label={active.isGroup && active.role !== "host" ? "Leave call" : "End call"}
                  title={active.isGroup && active.role !== "host" ? "Leave call" : "End call"}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <PhoneOff />
                </button>
              )}
            </footer>
          </div>
        ))}
    </CallsContext.Provider>
  );
}
