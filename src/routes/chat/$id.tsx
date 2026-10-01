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
  Camera,
  Smile,
  Copy,
  Forward,
  CheckCheck,
  Play,
  Phone,
  PhoneCall,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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

function CallEntry({ call, onCallBack }: { call: CallRow; onCallBack: () => void }) {
  const outgoing = call.status === "ended" || call.status === "missed";
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
      <div className="liquid-panel flex items-center gap-3 rounded-[24px] px-4 py-2.5 text-sm text-foreground shadow-sm">
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
        <Button variant="ghost" size="icon"
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
function Attachment({ message }: { message: MessageRow }) {
  const url = useRemoteUrl("attachments", message.attachment_url);
  if (!url) return <span className="text-sm">Loading attachment…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {message.attachment_type?.startsWith("image/") ? (
        <img
          src={url}
          alt={message.attachment_name ?? "Shared photo"}
          className="max-h-80 w-full rounded-xl object-contain"
          loading="lazy"
        />
      ) : message.media_kind === "voice" ? (
        <span className="flex items-center gap-3 rounded-xl bg-secondary px-3 py-3">
          <audio src={url} controls className="h-8 max-w-full" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Voice message</span>
            <span className="text-xs text-muted-foreground">
              {message.media_duration ? `${message.media_duration}s` : "Audio"}
            </span>
          </span>
        </span>
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
  const [stickersOpen, setStickersOpen] = useState(false);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const recordStarted = useRef(0);
  const touchStart = useRef<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [conv, rows, membership] = await Promise.all([
      supabase.from("conversations").select("name, is_group").eq("id", id).single(),
      supabase
        .from("messages")
        .select(
          "id, conversation_id, sender_id, body, attachment_url, attachment_type, reply_to, effect, created_at, edited_at, deleted_at",
        )
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
    setMessages(
      (rows.data ?? []).map((row) => ({
        ...row,
        attachment_name: null,
        attachment_size: null,
        media_duration: null,
        media_kind: null,
      })) as MessageRow[],
    );
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

  async function startRecording(kind: "voice" | "video-note") {
    if (recording || !user) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video-note",
    });
    const mediaRecorder = new MediaRecorder(stream);
    recordedChunks.current = [];
    recordStarted.current = Date.now();
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) recordedChunks.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.current = mediaRecorder;
    setRecording(kind);
    mediaRecorder.start();
  }

  async function stopRecording() {
    const mediaRecorder = recorder.current;
    const kind = recording;
    if (!mediaRecorder || !kind || !user) return;
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
    const file = new globalThis.File([blob], `${kind}-${crypto.randomUUID()}.webm`, {
      type: blob.type,
    });
    setRecording(null);
    try {
      const path = await uploadFile("attachments", user.id, file);
       const recordedMessage = {
        conversation_id: id,
        sender_id: user.id,
        body: null,
        attachment_url: path,
        attachment_type: file.type,
        reply_to: reply?.id ?? null,
      };
       const result = await supabase.from("messages").insert(recordedMessage);
      if (result.error) throw result.error;
      setReply(null);
      await refresh();
    } catch {
      toast.error("Recording could not be sent.");
    }
  }

  function toggleSelected(messageId: string) {
    setMultiSelect((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  async function sendSticker(emoji: string) {
    if (!user) return;
    await supabase.from("messages").insert({
      conversation_id: id,
      sender_id: user.id,
      body: emoji,
      attachment_url: null,
      attachment_type: null,
      reply_to: null,
    });
    setStickersOpen(false);
    await refresh();
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
  const lastOutgoing = messages.filter((m) => m.sender_id === user?.id).at(-1)?.id;
  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="liquid-panel relative flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-foreground hover:bg-primary/10"
        >
          <Link to="/" aria-label="Back to messages">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <div className="relative shrink-0">
            <ChatAvatar name={title} path={group ? null : other?.avatar_url} size={40} />
            {!group && (
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-presence" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <h1 className="truncate text-[15px] font-semibold tracking-[0.01em]">
              {title}
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {typing.length > 0 ? "typing…" : "online"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-foreground hover:bg-primary/10"
          aria-label="Conversation options"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </header>
      <section
        aria-label="Messages"
        className="flex-1 overflow-y-auto bg-background px-4 py-5"
      >
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
        {callEntries.map((call) => (
          <CallEntry
            key={call.id}
            call={call}
            onCallBack={() => void startCall(id, call.kind as "audio" | "video", title)}
          />
        ))}
        {messages.map((m, i) => {
          const own = m.sender_id === user?.id;
          const quoted = messages.find((x) => x.id === m.reply_to);
          const rs = reactions.filter((r) => r.message_id === m.id);
          const showDate =
            i === 0 ||
            new Date(m.created_at).getTime() -
              new Date(messages[i - 1]?.created_at ?? 0).getTime() >
              300000;
          return (
            <div
              key={m.id}
              id={`message-${m.id}`}
              className={`${targetMessage === m.id ? "rounded-lg ring-2 ring-primary" : ""} ${multiSelect.has(m.id) ? "bg-primary/10" : ""}`}
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
                <p className="my-5 text-center text-xs text-muted-foreground">
                  {formatDivider(m.created_at)}
                </p>
              )}
              <div className={`mb-2 flex flex-col ${own ? "items-end" : "items-start"}`}>
                {group && !own && (
                  <span className="mb-1 pl-3 text-xs text-muted-foreground">
                    {profiles.find((p) => p.id === m.sender_id)?.display_name}
                  </span>
                )}
                <div
                   className={`relative max-w-[82%] rounded-[26px] px-3.5 py-2 shadow-sm ${own ? "rounded-br-[10px] bg-bubble-out text-bubble-out-foreground" : "liquid-panel rounded-bl-[10px] text-foreground"}`}
                  onDoubleClick={() => !m.deleted_at && setSelected(m.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelected(m.id);
                  }}
                >
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
                </div>
                {!m.deleted_at && (
                  <div className="flex items-center gap-1">
                    {rs.length > 0 && (
                      <span
                         className="liquid-panel rounded-full px-2 text-sm"
                        aria-label="Tapbacks"
                      >
                        {Array.from(new Set(rs.map((r) => r.emoji))).join(" ")}{" "}
                        {rs.length > 1 ? rs.length : ""}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-7 text-muted-foreground"
                      aria-label={`Message actions ${i + 1}`}
                      onClick={() => setSelected(selected === m.id ? null : m.id)}
                    >
                      <MoreHorizontal />
                    </Button>
                    {m.edited_at && (
                      <span className="text-[10px] text-muted-foreground">Edited</span>
                    )}
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
                {own && m.id === lastOutgoing && !m.deleted_at && (
                  <span className="text-[11px] text-muted-foreground">
                    {members.filter((x) => x.user_id !== user?.id).length > 0 &&
                    members.every(
                      (x) =>
                        x.user_id === user?.id ||
                        new Date(x.last_read_at) >= new Date(m.created_at),
                    )
                      ? "Read"
                      : members.some(
                            (x) =>
                              x.user_id !== user?.id &&
                              new Date(x.last_read_at) >= new Date(m.created_at),
                          )
                        ? "Delivered"
                        : "Sent"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {typing.length > 0 && (
          <div
            role="status"
            className="mt-3 w-fit rounded-full bg-bubble-in px-4 py-2 text-sm text-muted-foreground"
          >
            {typing
              .map((t) => profiles.find((p) => p.id === t)?.display_name ?? "Someone")
              .join(", ")}{" "}
            is typing…
          </div>
        )}
        <div ref={bottom} />
      </section>
       <footer className="liquid-panel shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
            aria-label="Stickers"
          >
            {["🌈", "✨", "🔥", "🎈", "🫶", "🌻", "💫", "🥳"].map((sticker) => (
              <button
                key={sticker}
                onClick={() => void sendSticker(sticker)}
                aria-label={`Send sticker ${sticker}`}
              >
                {sticker}
              </button>
            ))}
          </div>
        )}
        {recording && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Recording {recording === "voice" ? "voice note" : "video note"} · release to send
          </div>
        )}
        <form
           className="liquid-panel flex items-end gap-2 rounded-[28px] p-2 shadow-sm"
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach photo or file"
            disabled={busy || !!editing || !ready || !!error}
            onClick={() => input.current?.click()}
             className="h-9 w-9 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open stickers"
            onClick={() => setStickersOpen((value) => !value)}
             className="h-9 w-9 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Smile className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Hold to record voice note"
            onPointerDown={() => void startRecording("voice")}
            onPointerUp={() => void stopRecording()}
            onPointerCancel={() => void stopRecording()}
             className="h-9 w-9 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Hold to record circular video note"
            onPointerDown={() => void startRecording("video-note")}
            onPointerUp={() => void stopRecording()}
            onPointerCancel={() => void stopRecording()}
             className="h-9 w-9 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Camera className="h-4 w-4" />
          </Button>
          <textarea
            aria-label="Message"
            placeholder="Message"
            rows={1}
            value={body}
            disabled={busy || !!error}
             className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-[24px] border border-glass-border bg-glass px-4 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
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
             className="mb-0.5 h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
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
