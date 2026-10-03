import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Plus,
  X,
  Loader2,
  Eye,
  Type as TypeIcon,
  Image as ImageIcon,
  Heart,
  Send,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar, useRemoteUrl } from "@/components/RemoteImage";
import { uploadFile } from "@/lib/storage";
import { formatListTime, type ProfileLite } from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Status — Ripple" },
      {
        name: "description",
        content: "Share photo, video and text updates that disappear after 24 hours.",
      },
      { property: "og:title", content: "Status — Ripple" },
      { property: "og:description", content: "Updates that disappear after 24 hours." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatusPage,
});

type StatusPost = {
  id: string;
  author_id: string;
  kind: "photo" | "video" | "text";
  media_url: string | null;
  media_type: string | null;
  body: string | null;
  background: string | null;
  created_at: string;
  expires_at: string;
  audience_mode?: "contacts" | "except" | "only";
  audience_ids?: string[];
  is_highlighted?: boolean;
};

type Viewer = { viewer_id: string; viewed_at: string };
type StatusReaction = { user_id: string; emoji: string };
type StatusReply = { id: string; sender_id: string; body: string; created_at: string };
const STATUS_REACTIONS = ["❤️", "😂", "😮", "😢", "👏"];

const BACKGROUNDS = ["#0b84ff", "#34c759", "#ff375f", "#ff9500", "#5e5ce6"];
const GRADIENTS = [
  "linear-gradient(135deg, #0b84ff, #5e5ce6)",
  "linear-gradient(135deg, #34c759, #0b84ff)",
  "linear-gradient(135deg, #ff375f, #ff9500)",
];

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function StatusPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StatusPost[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [myViews, setMyViews] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<null | "text" | "media">(null);
  const [viewing, setViewing] = useState<{ authorId: string; index: number } | null>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("status_posts")
      .select("*")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as StatusPost[];
    setPosts(rows);

    const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
    if (authorIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, status_text, last_seen")
        .in("id", authorIds);
      const map = new Map<string, ProfileLite>();
      (profs ?? []).forEach((p) => map.set(p.id, p as ProfileLite));
      setProfiles(map);
    }

    const { data: views } = await supabase
      .from("status_views")
      .select("status_id")
      .eq("viewer_id", user.id);
    setMyViews(new Set((views ?? []).map((v) => v.status_id)));
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("status-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "status_posts" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  const mine = useMemo(() => (posts ?? []).filter((p) => p.author_id === user?.id), [posts, user]);

  const groups = useMemo(() => {
    const others = (posts ?? []).filter(
      (p) => p.author_id !== user?.id,
    );
    const byAuthor = new Map<string, StatusPost[]>();
    others.forEach((p) => {
      const list = byAuthor.get(p.author_id) ?? [];
      list.push(p);
      byAuthor.set(p.author_id, list);
    });
    return Array.from(byAuthor.entries())
      .map(([authorId, list]) => ({
        authorId,
        list,
        unviewed: list.filter((p) => !myViews.has(p.id)).length,
        latest: list[list.length - 1]!,
      }))
      .sort((a, b) => {
        if (!!a.unviewed !== !!b.unviewed) return a.unviewed ? -1 : 1;
        return +new Date(b.latest.created_at) - +new Date(a.latest.created_at);
      });
  }, [posts, user, myViews]);

  const viewerPosts = viewing
    ? viewing.authorId === user?.id
      ? mine
      : (groups.find((g) => g.authorId === viewing.authorId)?.list ?? [])
    : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="liquid-panel sticky top-0 z-10 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-[2rem] font-bold text-foreground">Status</h1>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Status options"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>Create Channel</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>Status Privacy</DropdownMenuItem>
            <DropdownMenuItem disabled>Starred</DropdownMenuItem>
            <DropdownMenuItem disabled>Ad Preferences</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>Settings</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
      </header>

      <section className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon"
            onClick={() =>
              mine.length ? setViewing({ authorId: user!.id, index: 0 }) : setComposing("text")
            }
            className="relative h-14 w-14 rounded-full p-0"
            aria-label={mine.length ? "View my status" : "Add status"}
          >
            <span className={mine.length ? "rounded-full p-0.5 ring-2 ring-primary" : ""}><ChatAvatar name={profile?.display_name ?? "Me"} path={profile?.avatar_url} size={52} /></span>
            {mine.length === 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
              </span>
            )}
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold text-foreground">My status</p>
            <p className="text-[15px] text-muted-foreground">
              {mine.length
                 ? `${mine.length} update${mine.length > 1 ? "s" : ""} · ${relativeTime(mine[mine.length - 1]!.created_at)}`
                : "Tap to add an update"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="secondary"
              aria-label="Add text status"
              onClick={() => setComposing("text")}
            >
              <TypeIcon className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="Add photo or video status"
              onClick={() => setComposing("media")}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {posts === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="text-lg font-semibold text-foreground">No updates yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Updates from people you chat with appear here for 24 hours.
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {groups.map((g) => {
            const p = profiles.get(g.authorId);
            return (
              <li key={g.authorId}>
                  <Button variant="ghost"
                  onClick={() => setViewing({ authorId: g.authorId, index: 0 })}
                  className="h-auto w-full justify-start gap-3 rounded-[24px] px-4 py-3 text-left transition active:bg-secondary"
                >
                  <span
                    className={
                      g.unviewed
                        ? "rounded-full p-0.5 ring-2 ring-primary"
                        : "rounded-full p-0.5 ring-2 ring-border"
                    }
                  >
                    <ChatAvatar
                      name={p?.display_name ?? "Someone"}
                      path={p?.avatar_url}
                      size={48}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-semibold text-foreground">
                      {p?.display_name ?? "Someone"}
                    </p>
                    <p className="text-[15px] text-muted-foreground">
                       {relativeTime(g.latest.created_at)}
                      {g.unviewed ? ` · ${g.unviewed} new` : ""}
                    </p>
                  </div>
                  </Button>
              </li>
            );
          })}
        </ul>
      )}

      {composing && user && (
        <Composer
          mode={composing}
          userId={user.id}
          onClose={() => setComposing(null)}
          onPosted={() => {
            setComposing(null);
            void refresh();
          }}
        />
      )}

      {viewing && viewerPosts.length > 0 && user && (
        <StatusViewer
          posts={viewerPosts}
          startIndex={viewing.index}
          author={
            viewing.authorId === user.id
              ? {
                  display_name: profile?.display_name ?? "Me",
                  avatar_url: profile?.avatar_url ?? null,
                }
              : {
                  display_name: profiles.get(viewing.authorId)?.display_name ?? "Someone",
                  avatar_url: profiles.get(viewing.authorId)?.avatar_url ?? null,
                }
          }
          isMine={viewing.authorId === user.id}
          viewerId={user.id}
          onViewed={(id) => setMyViews((s) => new Set(s).add(id))}
          onClose={() => {
            setViewing(null);
            void refresh();
          }}
        />
      )}

      <BottomNav />
    </main>
  );
}

function Composer({
  mode,
  userId,
  onClose,
  onPosted,
}: {
  mode: "text" | "media";
  userId: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [text, setText] = useState("");
  const [background, setBackground] = useState(BACKGROUNDS[0]!);
  const [gradient, setGradient] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [audienceMode, setAudienceMode] = useState<"contacts" | "except" | "only">("contacts");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [audienceContacts, setAudienceContacts] = useState<
    { id: string; display_name: string }[] | null
  >(null);
  const [audienceContactsError, setAudienceContactsError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "media") fileInput.current?.click();
  }, [mode]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: memberships, error: membershipsError } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", userId);
      if (membershipsError) throw membershipsError;
      const conversationIds = (memberships ?? []).map((membership) => membership.conversation_id);
      if (!conversationIds.length) {
        if (active) setAudienceContacts([]);
        return;
      }

      const { data: members, error: membersError } = await supabase
        .from("conversation_members")
        .select("user_id")
        .in("conversation_id", conversationIds);
      if (membersError) throw membersError;
      const contactIds = Array.from(new Set((members ?? []).map((member) => member.user_id))).filter(
        (id) => id !== userId,
      );
      if (!contactIds.length) {
        if (active) setAudienceContacts([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", contactIds)
        .order("display_name");
      if (profilesError) throw profilesError;
      if (active) {
        setAudienceContacts(
          (profiles ?? []).map((contact) => ({
            id: contact.id,
            display_name: contact.display_name ?? "Contact",
          })),
        );
      }
    })().catch(() => {
      if (!active) return;
      setAudienceContactsError(true);
      setAudienceContacts([]);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  async function publish() {
    setBusy(true);
    try {
      if (mode === "text") {
        if (!text.trim()) return;
        const { error } = await supabase.from("status_posts").insert({
          author_id: userId,
          kind: "text",
          body: text.trim(),
          background: gradient ?? background,
          audience_mode: audienceMode,
          audience_ids: audienceIds,
        });
        if (error) throw error;
      } else {
        if (!file) return;
        const path = await uploadFile("status", userId, file);
        const { error } = await supabase.from("status_posts").insert({
          author_id: userId,
          kind: file.type.startsWith("video/") ? "video" : "photo",
          media_url: path,
          media_type: file.type,
          audience_mode: audienceMode,
          audience_ids: audienceIds,
        });
        if (error) throw error;
      }
      toast.success("Status posted");
      onPosted();
    } catch {
      toast.error("Your status could not be posted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/95 p-4 text-background">
      <div className="flex justify-end">
        <button onClick={onClose} aria-label="Close status composer">
          <X />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {mode === "text" ? (
          <div
            className="flex h-64 w-full items-center justify-center rounded-2xl p-6"
            style={{ backgroundColor: background, backgroundImage: gradient ?? undefined }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a status"
              aria-label="Status text"
              className="w-full resize-none bg-transparent text-center text-2xl font-semibold text-white outline-none placeholder:text-white/70"
            />
          </div>
        ) : file ? (
          file.type.startsWith("video/") ? (
            <video src={URL.createObjectURL(file)} controls className="max-h-[60vh] rounded-2xl" />
          ) : (
            <img
              src={URL.createObjectURL(file)}
              alt="Selected status"
              className="max-h-[60vh] rounded-2xl"
            />
          )
        ) : (
          <p className="text-sm opacity-80">Choose a photo or video</p>
        )}
      </div>

      {mode === "text" && (
        <div className="mb-4 flex justify-center gap-3">
          {BACKGROUNDS.map((c) => (
            <button
              key={c}
              onClick={() => setBackground(c)}
              aria-label={`Background ${c}`}
              className="h-8 w-8 rounded-full ring-2 ring-background/50"
              style={{ backgroundColor: c }}
            />
          ))}
          {GRADIENTS.map((value) => (
            <button
              key={value}
              onClick={() => setGradient(value)}
              aria-label="Gradient background"
              className="h-8 w-8 rounded-full ring-2 ring-background/50"
              style={{ backgroundImage: value }}
            />
          ))}
        </div>
      )}

      <div className="mb-4 space-y-2">
        <label className="block text-sm font-medium" htmlFor="status-audience">
          Status audience
        </label>
        <select
          id="status-audience"
          value={audienceMode}
          onChange={(event) => setAudienceMode(event.target.value as typeof audienceMode)}
          disabled={busy}
          className="w-full rounded-lg bg-background/15 px-3 py-2 text-sm text-background"
        >
          <option value="contacts">All my contacts</option>
          <option value="except">My contacts, except...</option>
          <option value="only">Only share with...</option>
        </select>
        {audienceMode !== "contacts" && (
          <div className="max-h-32 overflow-y-auto rounded-lg bg-background/10">
            {audienceContacts === null ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : audienceContactsError ? (
              <p className="px-3 py-2 text-sm">Contacts could not be loaded. Try again later.</p>
            ) : audienceContacts.length === 0 ? (
              <p className="px-3 py-2 text-sm">No contacts to select.</p>
            ) : (
              audienceContacts.map((contact) => (
                <label key={contact.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={audienceIds.includes(contact.id)}
                    onChange={(event) =>
                      setAudienceIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, contact.id])]
                          : current.filter((id) => id !== contact.id),
                      )
                    }
                    disabled={busy}
                  />
                  <span>{contact.display_name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <Button
        onClick={() => void publish()}
        disabled={
          busy ||
          (mode === "text" ? !text.trim() : !file) ||
          (audienceMode !== "contacts" && (audienceContacts === null || audienceContactsError)) ||
          (audienceMode === "only" && audienceIds.length === 0)
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share status"}
      </Button>
    </div>
  );
}

function StatusViewer({
  posts,
  startIndex,
  author,
  isMine,
  viewerId,
  onViewed,
  onClose,
}: {
  posts: StatusPost[];
  startIndex: number;
  author: { display_name: string; avatar_url: string | null };
  isMine: boolean;
  viewerId: string;
  onViewed: (id: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [showViewers, setShowViewers] = useState(false);
  const [viewerProfiles, setViewerProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [reactions, setReactions] = useState<StatusReaction[]>([]);
  const [replies, setReplies] = useState<StatusReply[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [interactionError, setInteractionError] = useState(false);
  const [interactionRevision, setInteractionRevision] = useState(0);
  const post = posts[Math.min(index, posts.length - 1)]!;
  const mediaUrl = useRemoteUrl("status", post.kind === "text" ? null : post.media_url);
  const nextMediaUrl = useRemoteUrl("status", posts[index + 1]?.media_url ?? null);

  useEffect(() => {
    let active = true;
    setInteractionError(false);
    setReactions([]);
    setReplies([]);
    void (async () => {
      const { data: reactionRows, error: reactionError } = await supabase
        .from("status_reactions")
        .select("user_id, emoji")
        .eq("status_id", post.id);
      if (reactionError) throw reactionError;
      if (active) setReactions(reactionRows ?? []);

      if (isMine) {
        const { data: replyRows, error: replyError } = await supabase
          .from("status_replies")
          .select("id, sender_id, body, created_at")
          .eq("status_id", post.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (replyError) throw replyError;
        if (active) setReplies(replyRows ?? []);
      }
    })().catch(() => {
      if (active) setInteractionError(true);
    });
    return () => {
      active = false;
    };
  }, [post.id, isMine, interactionRevision]);

  async function toggleStatusReaction(emoji: string) {
    const ownReaction = reactions.find((reaction) => reaction.user_id === viewerId);
    const removing = ownReaction?.emoji === emoji;
    const result = removing
      ? await supabase
          .from("status_reactions")
          .delete()
          .eq("status_id", post.id)
          .eq("user_id", viewerId)
      : await supabase.from("status_reactions").upsert(
          { status_id: post.id, user_id: viewerId, emoji },
          { onConflict: "status_id,user_id" },
        );
    if (result.error) {
      toast.error("Your reaction could not be saved.");
      return;
    }
    setReactions((current) => [
      ...current.filter((reaction) => reaction.user_id !== viewerId),
      ...(removing ? [] : [{ user_id: viewerId, emoji }]),
    ]);
  }

  async function sendStatusReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body || isMine) return;
    setReplyBusy(true);
    const { error } = await supabase
      .from("status_replies")
      .insert({ status_id: post.id, sender_id: viewerId, body });
    setReplyBusy(false);
    if (error) {
      toast.error("Your reply could not be sent. Try again.");
      return;
    }
    setReplyBody("");
    toast.success("Reply sent");
  }

  // Record the view (own statuses are never recorded as views).
  useEffect(() => {
    if (isMine) return;
    void supabase
      .from("status_views")
      .upsert({ status_id: post.id, viewer_id: viewerId }, { onConflict: "status_id,viewer_id" })
      .then(() => onViewed(post.id));
  }, [post.id, isMine, viewerId, onViewed]);

  // Author's viewer list.
  useEffect(() => {
    if (!isMine) return;
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("status_views")
        .select("viewer_id, viewed_at")
        .eq("status_id", post.id)
        .order("viewed_at", { ascending: false });
      if (!active) return;
      const rows = (data ?? []) as Viewer[];
      setViewers(rows);
      if (rows.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, status_text, last_seen")
          .in(
            "id",
            rows.map((r) => r.viewer_id),
          );
        if (!active) return;
        const map = new Map<string, ProfileLite>();
        (profs ?? []).forEach((p) => map.set(p.id, p as ProfileLite));
        setViewerProfiles(map);
      }
    })();
    return () => {
      active = false;
    };
  }, [post.id, isMine]);

  // Auto-advance, pausable.
  useEffect(() => {
    setProgress(0);
    if (paused || showViewers) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / 6000) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(timer);
        if (index < posts.length - 1) setIndex((i) => i + 1);
        else onClose();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [index, paused, showViewers, posts.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex gap-1 px-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {posts.map((p, i) => (
          <div key={p.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full bg-white"
              style={{ width: i < index ? "100%" : i === index ? `${progress}%` : "0%" }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <ChatAvatar name={author.display_name} path={author.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {isMine ? "My status" : author.display_name}
          </p>
          <p className="text-xs opacity-70">{formatListTime(post.created_at)}</p>
        </div>
        <button onClick={onClose} aria-label="Close status">
          <X />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center"
        onPointerDown={(event) => {
          setTouchStart(event.clientX);
          setPaused(true);
        }}
        onPointerUp={(event) => {
          if (touchStart !== null && Math.abs(event.clientX - touchStart) > 48) {
            if (event.clientX < touchStart && index < posts.length - 1) setIndex((i) => i + 1);
            if (event.clientX > touchStart && index > 0) setIndex((i) => i - 1);
          }
          setTouchStart(null);
          setPaused(false);
        }}
        onPointerLeave={() => setPaused(false)}
      >
        <button
          className="absolute inset-y-0 left-0 w-1/3"
          aria-label="Previous status"
          onClick={() => setIndex((i) => (i > 0 ? i - 1 : i))}
        />
        <button
          className="absolute inset-y-0 right-0 w-1/3"
          aria-label="Next status"
          onClick={() => (index < posts.length - 1 ? setIndex((i) => i + 1) : onClose())}
        />
        {post.kind === "text" ? (
          <div
            className="mx-4 flex min-h-64 w-full items-center justify-center rounded-2xl p-8 text-center text-2xl font-semibold"
            style={
              post.background?.startsWith("linear-gradient")
                ? { backgroundImage: post.background }
                : { backgroundColor: post.background ?? BACKGROUNDS[0]! }
            }
          >
            {post.body}
          </div>
        ) : !mediaUrl ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : post.kind === "video" ? (
          <video
            src={mediaUrl}
            autoPlay
            playsInline
            controls={false}
            className="max-h-full w-full object-contain"
          />
        ) : (
          <img src={mediaUrl} alt="Status" className="max-h-full w-full object-contain" />
        )}
        {nextMediaUrl && <img src={nextMediaUrl} alt="" aria-hidden className="hidden" />}
      </div>


      {isMine && (
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => setShowViewers((s) => !s)}
            className="flex items-center gap-2 text-sm"
            aria-expanded={showViewers}
          >
            <Eye className="h-4 w-4" /> {viewers?.length ?? 0} viewed
          </button>
          {showViewers && (
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {(viewers ?? []).map((v) => (
                <li key={v.viewer_id} className="flex items-center gap-2 text-sm">
                  <ChatAvatar
                    name={viewerProfiles.get(v.viewer_id)?.display_name ?? "Someone"}
                    path={viewerProfiles.get(v.viewer_id)?.avatar_url}
                    size={28}
                  />
                  <span className="flex-1 truncate">
                    {viewerProfiles.get(v.viewer_id)?.display_name ?? "Someone"}
                  </span>
                  <span className="opacity-70">{formatListTime(v.viewed_at)}</span>
                </li>
              ))}
              {viewers?.length === 0 && <li className="text-sm opacity-70">No views yet</li>}
            </ul>
          )}
          {replies.length > 0 && (
            <ul className="mt-3 max-h-32 space-y-2 overflow-y-auto border-t border-white/20 pt-3">
              {replies.map((reply) => (
                <li key={reply.id} className="flex items-start justify-between gap-3 text-sm">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{reply.body}</p>
                  <span className="shrink-0 text-xs opacity-70">
                    {formatListTime(reply.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isMine && (
        <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {interactionError ? (
            <button
              type="button"
              onClick={() => setInteractionRevision((revision) => revision + 1)}
              className="text-sm underline"
            >
              Reactions could not load. Retry
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2">
              {STATUS_REACTIONS.map((emoji) => {
                const count = reactions.filter((reaction) => reaction.emoji === emoji).length;
                const selected = reactions.some(
                  (reaction) => reaction.user_id === viewerId && reaction.emoji === emoji,
                );
                return (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`React with ${emoji}${count ? `, ${count} reactions` : ""}`}
                    aria-pressed={selected}
                    onClick={() => void toggleStatusReaction(emoji)}
                    className={`min-w-12 rounded-full px-3 py-2 ${selected ? "bg-white/30" : "bg-white/10"}`}
                  >
                    {emoji} {count > 0 && <span className="text-xs">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <form onSubmit={(event) => void sendStatusReply(event)} className="flex gap-2">
            <input
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              maxLength={1000}
              placeholder="Reply to status"
              aria-label="Reply to status"
              className="min-w-0 flex-1 rounded-full bg-white/15 px-4 py-2 text-sm text-white placeholder:text-white/60 outline-none"
            />
            <Button
              type="submit"
              size="icon"
              variant="secondary"
              aria-label="Send status reply"
              disabled={replyBusy || !replyBody.trim()}
            >
              {replyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
