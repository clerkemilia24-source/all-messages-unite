import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Loader2, Eye, Type as TypeIcon, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar, useRemoteUrl } from "@/components/RemoteImage";
import { uploadFile } from "@/lib/storage";
import { formatListTime, type ProfileLite } from "@/lib/chat";
import { Button } from "@/components/ui/button";

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
};

type Viewer = { viewer_id: string; viewed_at: string };

const BACKGROUNDS = ["#0b84ff", "#34c759", "#ff375f", "#ff9500", "#5e5ce6"];

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

  const mine = useMemo(
    () => (posts ?? []).filter((p) => p.author_id === user?.id),
    [posts, user],
  );

  const groups = useMemo(() => {
    const others = (posts ?? []).filter((p) => p.author_id !== user?.id);
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
      <header className="sticky top-0 z-10 border-b border-border bg-chrome px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <h1 className="text-[2rem] font-bold tracking-tight text-foreground">Status</h1>
      </header>

      <section className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (mine.length ? setViewing({ authorId: user!.id, index: 0 }) : setComposing("text"))}
            className="relative"
            aria-label={mine.length ? "View my status" : "Add status"}
          >
            <ChatAvatar name={profile?.display_name ?? "Me"} path={profile?.avatar_url} size={52} />
            {mine.length === 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold text-foreground">My status</p>
            <p className="text-[15px] text-muted-foreground">
              {mine.length
                ? `${mine.length} update${mine.length > 1 ? "s" : ""} · ${formatListTime(mine[mine.length - 1]!.created_at)}`
                : "Tap to add an update"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="icon" variant="secondary" aria-label="Add text status" onClick={() => setComposing("text")}>
              <TypeIcon className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="secondary" aria-label="Add photo or video status" onClick={() => setComposing("media")}>
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
                <button
                  onClick={() => setViewing({ authorId: g.authorId, index: 0 })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-secondary"
                >
                  <span
                    className={
                      g.unviewed
                        ? "rounded-full p-0.5 ring-2 ring-primary"
                        : "rounded-full p-0.5 ring-2 ring-border"
                    }
                  >
                    <ChatAvatar name={p?.display_name ?? "Someone"} path={p?.avatar_url} size={48} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-semibold text-foreground">
                      {p?.display_name ?? "Someone"}
                    </p>
                    <p className="text-[15px] text-muted-foreground">
                      {formatListTime(g.latest.created_at)}
                      {g.unviewed ? ` · ${g.unviewed} new` : ""}
                    </p>
                  </div>
                </button>
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
              ? { display_name: profile?.display_name ?? "Me", avatar_url: profile?.avatar_url ?? null }
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "media") fileInput.current?.click();
  }, [mode]);

  async function publish() {
    setBusy(true);
    try {
      if (mode === "text") {
        if (!text.trim()) return;
        const { error } = await supabase.from("status_posts").insert({
          author_id: userId,
          kind: "text",
          body: text.trim(),
          background,
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
            style={{ backgroundColor: background }}
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
            <img src={URL.createObjectURL(file)} alt="Selected status" className="max-h-[60vh] rounded-2xl" />
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
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <Button onClick={() => void publish()} disabled={busy || (mode === "text" ? !text.trim() : !file)}>
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
  const post = posts[Math.min(index, posts.length - 1)]!;
  const mediaUrl = useRemoteUrl("status", post.kind === "text" ? null : post.media_url);

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
          .in("id", rows.map((r) => r.viewer_id));
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
          <p className="truncate text-sm font-semibold">{isMine ? "My status" : author.display_name}</p>
          <p className="text-xs opacity-70">{formatListTime(post.created_at)}</p>
        </div>
        <button onClick={onClose} aria-label="Close status">
          <X />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
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
            style={{ backgroundColor: post.background ?? BACKGROUNDS[0]! }}
          >
            {post.body}
          </div>
        ) : !mediaUrl ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : post.kind === "video" ? (
          <video src={mediaUrl} autoPlay playsInline controls={false} className="max-h-full w-full object-contain" />
        ) : (
          <img src={mediaUrl} alt="Status" className="max-h-full w-full object-contain" />
        )}
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
        </div>
      )}
    </div>
  );
}
