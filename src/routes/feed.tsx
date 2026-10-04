// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Flag,
  Globe2,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Plus,
  Radio,
  Repeat2,
  Send,
  Share2,
  UserRoundPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar } from "@/components/RemoteImage";
import { supabase } from "@/integrations/supabase/client";
import {
  addSocialComment,
  getSocialFeed,
  publishSocialPost,
  recordSocialPostView,
  reportSocialPost,
} from "@/lib/feed.functions";
import { formatListTime } from "@/lib/chat";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Feed — Ripple" },
      { name: "description", content: "Public posts and updates from people you follow." },
      { property: "og:title", content: "Feed — Ripple" },
      { property: "og:description", content: "Public posts and updates from people you follow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeedPage,
});

type FeedScope = "for-you" | "following" | "friends" | "trending";
type FeedPost = Awaited<ReturnType<typeof getSocialFeed>>[number];
type ReportReason = "spam" | "harassment" | "violence" | "sexual" | "other";
const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;
type FeedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

type FeedPostScreenProps = {
  post: FeedPost;
  index: number;
  activeIndex: number;
  active: boolean;
  paused: boolean;
  muted: boolean;
  viewerId: string | undefined;
  onLike: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
  onRepost: () => void;
  onFollow: () => void;
  onVideoTap: () => void;
  onToggleMute: () => void;
  onReport: () => void;
  setVideoRef: (postId: string, element: HTMLVideoElement | null) => void;
};

function FeedPostScreen({
  post,
  index,
  activeIndex,
  active,
  paused,
  muted,
  viewerId,
  onLike,
  onComment,
  onSave,
  onShare,
  onRepost,
  onFollow,
  onVideoTap,
  onToggleMute,
  onReport,
  setVideoRef,
}: FeedPostScreenProps) {
  const author = post.original?.author ?? post.author;
  const mediaUrl = post.mediaUrl ?? post.original?.mediaUrl ?? null;
  const mediaType = post.media_type ?? post.original?.media_type ?? null;
  const isVideo = mediaType?.startsWith("video/") === true;
  const nearActive = Math.abs(index - activeIndex) <= 1;
  return (
    <article
      id={`post-${post.id}`}
      data-feed-index={index}
      className="relative h-dvh w-full snap-start overflow-hidden bg-neutral-950"
    >
      {mediaUrl && isVideo ? (
        <video
          ref={(element) => setVideoRef(post.id, element)}
          src={nearActive ? mediaUrl : undefined}
          muted={muted}
          loop
          playsInline
          autoPlay={active && !paused}
          preload={active ? "auto" : nearActive ? "metadata" : "none"}
          onClick={onVideoTap}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : mediaUrl && mediaType?.startsWith("image/") ? (
        <img
          src={nearActive ? mediaUrl : undefined}
          alt=""
          loading={nearActive ? "eager" : "lazy"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_30%_20%,rgba(26,116,114,0.48),transparent_58%),linear-gradient(155deg,#182d35,#121417_60%,#412d24)] px-8 pb-24 text-center">
          <p className="max-h-[55dvh] overflow-hidden whitespace-pre-wrap break-words text-2xl font-semibold">
            {post.body ?? post.original?.body ?? "Shared a post"}
          </p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/75" />

      <div className="absolute inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-10 flex items-end justify-between gap-4">
        <div className="min-w-0 max-w-[75%]">
          <div className="mb-3 flex items-center gap-3">
            <ChatAvatar
              name={author?.display_name ?? "Someone"}
              path={author?.avatar_url ?? null}
              size={42}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{author?.display_name ?? "Someone"}</p>
              <p className="truncate text-xs text-white/75">
                @{author?.username ?? "member"} · {formatListTime(post.created_at)}
              </p>
            </div>
            {post.author_id !== viewerId && (
              <button
                type="button"
                onClick={onFollow}
                aria-label={post.followingAuthor ? "Unfollow creator" : "Follow creator"}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15"
              >
                <UserRoundPlus className="h-4 w-4" />
              </button>
            )}
          </div>
          {(post.body || post.original?.body) && (
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-5">
              {post.body ?? post.original?.body}
            </p>
          )}
          <p className="mt-2 text-xs text-white/75">
            {post.viewCount.toLocaleString()} views{post.repost_of ? " · Repost" : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4 pb-1">
          <button
            type="button"
            onClick={onLike}
            aria-label={post.likedByMe ? "Unlike post" : "Like post"}
            className="flex flex-col items-center gap-1"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md">
              <Heart className={`h-6 w-6 ${post.likedByMe ? "fill-rose-500 text-rose-500" : ""}`} />
            </span>
            <span className="text-xs font-semibold">{post.likeCount}</span>
          </button>
          <button
            type="button"
            onClick={onComment}
            aria-label="Open comments"
            className="flex flex-col items-center gap-1"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md">
              <MessageCircle className="h-6 w-6" />
            </span>
            <span className="text-xs font-semibold">{post.comments.length}</span>
          </button>
          <button
            type="button"
            onClick={onSave}
            aria-label={post.savedByMe ? "Remove saved post" : "Save post"}
            className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md"
          >
            {post.savedByMe ? (
              <BookmarkCheck className="h-5 w-5" />
            ) : (
              <Bookmark className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={onShare}
            aria-label="Share post"
            className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md"
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onRepost}
            aria-label="Repost"
            className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md"
          >
            <Repeat2 className="h-5 w-5" />
          </button>
          {isVideo && (
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? "Unmute video" : "Mute video"}
              className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md"
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          )}
          {post.author_id !== viewerId && (
            <button
              type="button"
              onClick={onReport}
              aria-label="Report post"
              className="grid h-11 w-11 place-items-center rounded-full bg-black/30 backdrop-blur-md"
            >
              <Flag className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function FeedPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<FeedScope>("for-you");
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [pausedPostId, setPausedPostId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [publishing, setPublishing] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reportReasons, setReportReasons] = useState<Record<string, ReportReason>>({});
  const feedScroller = useRef<HTMLDivElement>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const viewedPosts = useRef(new Set<string>());
  const pageRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const restoredPositionKey = useRef("");
  const lastTap = useRef<{ postId: string; time: number } | null>(null);

  const positionKey = user ? `ripple-feed:${user.id}:${scope}` : null;

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const firstPage = await getSocialFeed({ data: { scope, page: 0 } });
      setPosts(firstPage);
      pageRef.current = 0;
      setHasMore(firstPage.length === 20);
    } catch (error) {
      console.error("[feed] Could not load posts", error);
      toast.error("Could not load the feed.");
      setPosts([]);
      setHasMore(false);
    }
  }, [scope, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!user || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const nextPosts = await getSocialFeed({ data: { scope, page: nextPage } });
      setPosts((current) => {
        const existing = new Set((current ?? []).map((post) => post.id));
        return [...(current ?? []), ...nextPosts.filter((post) => !existing.has(post.id))];
      });
      pageRef.current = nextPage;
      setHasMore(nextPosts.length === 20);
    } catch (error) {
      console.error("[feed] Could not load the next page", error);
      toast.error("More posts could not be loaded.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, scope, user]);

  useEffect(() => {
    const container = feedScroller.current;
    if (!container || !posts?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset["feedIndex"]);
          if (Number.isInteger(index)) setActiveIndex(index);
        }
      },
      { root: container, threshold: 0.7 },
    );
    container.querySelectorAll("[data-feed-index]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [posts]);

  useEffect(() => {
    if (!positionKey || !posts?.length || restoredPositionKey.current === positionKey) return;
    restoredPositionKey.current = positionKey;
    const savedPosition = Number(sessionStorage.getItem(positionKey) ?? 0);
    if (savedPosition > 0)
      feedScroller.current?.scrollTo({ top: savedPosition, behavior: "instant" });
  }, [positionKey, posts]);

  useEffect(() => {
    if (positionKey) restoredPositionKey.current = "";
  }, [positionKey]);

  useEffect(() => {
    if (posts && activeIndex >= posts.length - 4 && hasMore) void loadMore();
  }, [activeIndex, hasMore, loadMore, posts]);

  useEffect(() => {
    const activePost = posts?.[activeIndex];
    if (
      !activePost ||
      !activePost.media_type?.startsWith("video/") ||
      viewedPosts.current.has(activePost.id)
    )
      return;
    const timer = window.setTimeout(() => {
      viewedPosts.current.add(activePost.id);
      void recordSocialPostView({ data: { postId: activePost.id } }).catch((error) => {
        viewedPosts.current.delete(activePost.id);
        console.warn("[feed] Could not record video view", error);
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, posts]);

  useEffect(() => {
    for (const [index, post] of (posts ?? []).entries()) {
      const video = videoRefs.current.get(post.id);
      if (!video) continue;
      if (index === activeIndex && pausedPostId !== post.id) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [activeIndex, muted, pausedPostId, posts]);

  useEffect(() => {
    setPausedPostId(null);
  }, [activeIndex]);

  useEffect(() => {
    const postId = new URLSearchParams(window.location.search).get("post");
    if (!postId || !posts?.length) return;
    document.getElementById(`post-${postId}`)?.scrollIntoView({ block: "center" });
  }, [posts]);

  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || (!draft.trim() && !file)) return;
    if (file && file.size > 50 * 1024 * 1024) {
      toast.error("Choose a photo or video smaller than 50 MB.");
      return;
    }
    if (file && !SUPPORTED_MEDIA_TYPES.includes(file.type as FeedMediaType)) {
      toast.error("That media format is not supported.");
      return;
    }

    setPublishing(true);
    let mediaPath: string | null = null;
    try {
      if (file) {
        const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        mediaPath = `${user.id}/${crypto.randomUUID()}-${name}`;
        const { error } = await supabase.storage.from("feed-review").upload(mediaPath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
      }
      await publishSocialPost({
        data: {
          body: draft.trim() || null,
          mediaPath,
          mediaType: file ? (file.type as FeedMediaType) : null,
          visibility,
          repostId: null,
        },
      });
      setDraft("");
      setFile(null);
      setComposeOpen(false);
      toast.success("Your post is live.");
      await refresh();
    } catch (error) {
      if (mediaPath) await supabase.storage.from("feed-review").remove([mediaPath]);
      console.error("[feed] Publishing failed", error);
      toast.error(error instanceof Error ? error.message : "Your post could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  async function toggleLike(post: FeedPost) {
    if (!user) return;
    const result = post.likedByMe
      ? await supabase
          .from("social_post_likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", user.id)
      : await supabase.from("social_post_likes").insert({ post_id: post.id, user_id: user.id });
    if (result.error) toast.error("Could not update your like.");
    else
      setPosts(
        (current) =>
          current?.map((item) =>
            item.id === post.id
              ? {
                  ...item,
                  likedByMe: !post.likedByMe,
                  likeCount: Math.max(0, item.likeCount + (post.likedByMe ? -1 : 1)),
                }
              : item,
          ) ?? null,
      );
  }

  async function toggleSave(post: FeedPost) {
    if (!user) return;
    const result = post.savedByMe
      ? await supabase
          .from("social_post_saves")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", user.id)
      : await supabase.from("social_post_saves").insert({ post_id: post.id, user_id: user.id });
    if (result.error) toast.error("Could not update saved posts.");
    else
      setPosts(
        (current) =>
          current?.map((item) =>
            item.id === post.id ? { ...item, savedByMe: !post.savedByMe } : item,
          ) ?? null,
      );
  }

  function handleVideoTap(post: FeedPost) {
    const now = Date.now();
    if (lastTap.current?.postId === post.id && now - lastTap.current.time < 300) {
      if (!post.likedByMe) void toggleLike(post);
      lastTap.current = null;
    } else {
      lastTap.current = { postId: post.id, time: now };
      window.setTimeout(() => {
        if (lastTap.current?.postId !== post.id || lastTap.current.time !== now) return;
        setPausedPostId((current) => (current === post.id ? null : post.id));
        lastTap.current = null;
      }, 300);
    }
  }

  async function toggleFollow(post: FeedPost) {
    if (!user) return;
    const result = post.followingAuthor
      ? await supabase
          .from("social_follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", post.author_id)
      : await supabase
          .from("social_follows")
          .insert({ follower_id: user.id, following_id: post.author_id });
    if (result.error) toast.error("Could not update your follows.");
    else
      setPosts(
        (current) =>
          current?.map((item) =>
            item.author_id === post.author_id
              ? { ...item, followingAuthor: !post.followingAuthor }
              : item,
          ) ?? null,
      );
  }

  async function addComment(event: FormEvent<HTMLFormElement>, postId: string) {
    event.preventDefault();
    const body = commentDrafts[postId]?.trim();
    if (!body) return;
    try {
      await addSocialComment({ data: { postId, body } });
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      await refresh();
    } catch (error) {
      console.error("[feed] Comment failed", error);
      toast.error(error instanceof Error ? error.message : "Could not add this comment.");
    }
  }

  async function repost(post: FeedPost) {
    try {
      await publishSocialPost({
        data: {
          body: null,
          mediaPath: null,
          mediaType: null,
          visibility: post.visibility,
          repostId: post.id,
        },
      });
      toast.success("Reposted.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not repost this item.");
    }
  }

  async function share(postId: string) {
    const url = `${window.location.origin}/feed?post=${postId}`;
    try {
      if (navigator.share) await navigator.share({ title: "Ripple post", url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError")
        toast.error("Could not share this post.");
    }
  }

  async function report(postId: string) {
    try {
      await reportSocialPost({
        data: { postId, reason: reportReasons[postId] ?? "spam", details: null },
      });
      toast.success("Report received.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit this report.");
    }
  }

  const commentsPost = posts?.find((post) => post.id === commentsPostId) ?? null;

  return (
    <main className="relative mx-auto h-dvh w-full max-w-2xl overflow-hidden bg-black text-white">
      <header className="liquid-chrome absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="flex min-w-0 items-center gap-2">
          <Globe2 className="h-5 w-5 shrink-0 text-white" aria-hidden="true" />
          <h1 className="text-lg font-bold">Ripple</h1>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto rounded-full bg-black/30 p-1 backdrop-blur-md">
          <div className="flex w-max items-center gap-1">
            {(
              [
                { value: "for-you", label: "For You" },
                { value: "following", label: "Following" },
                { value: "friends", label: "Friends" },
                { value: "trending", label: "Trending" },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={`min-h-9 whitespace-nowrap rounded-full px-3 text-sm font-semibold ${scope === value ? "bg-white text-black" : "text-white/80"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: "/live" })}
          aria-label="Open LIVE"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-600"
        >
          <Radio className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          aria-label="Create post"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-3 text-foreground sm:items-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Create post"
            className="w-full max-w-xl rounded-t-xl bg-background p-5 sm:rounded-xl"
          >
            <form onSubmit={(event) => void createPost(event)} className="space-y-3">
              <div className="flex items-start gap-3">
                <ChatAvatar
                  name={profile?.display_name ?? "You"}
                  path={profile?.avatar_url ?? null}
                  size={42}
                />
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  aria-label="Write a post"
                  placeholder="What would you like to share?"
                  className="min-h-20 flex-1 resize-y bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              {file && (
                <div className="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-primary hover:bg-secondary">
                    <ImagePlus className="h-4 w-4" />
                    <span>Photo or video</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                      className="sr-only"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <select
                    value={visibility}
                    onChange={(event) =>
                      setVisibility(event.target.value as "public" | "followers")
                    }
                    aria-label="Post audience"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="public">Public</option>
                    <option value="followers">Followers</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={publishing || (!draft.trim() && !file)}
                  className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {publishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Post
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {posts === null ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 py-20 text-center">
          <Users className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">No posts yet</p>
        </div>
      ) : (
        <section
          ref={feedScroller}
          aria-label="Posts"
          onScroll={(event) => {
            if (positionKey)
              sessionStorage.setItem(positionKey, String(event.currentTarget.scrollTop));
          }}
          className="absolute inset-0 z-0 h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {posts.map((post, index) => (
            <FeedPostScreen
              key={post.id}
              post={post}
              index={index}
              activeIndex={activeIndex}
              active={index === activeIndex}
              paused={pausedPostId === post.id}
              muted={muted}
              viewerId={user?.id}
              onLike={() => void toggleLike(post)}
              onComment={() => setCommentsPostId(post.id)}
              onSave={() => void toggleSave(post)}
              onShare={() => void share(post.id)}
              onRepost={() => void repost(post)}
              onFollow={() => void toggleFollow(post)}
              onVideoTap={() => handleVideoTap(post)}
              onToggleMute={() => setMuted((current) => !current)}
              onReport={() => setReportPostId(post.id)}
              setVideoRef={(postId, element) => {
                if (element) videoRefs.current.set(postId, element);
                else videoRefs.current.delete(postId);
              }}
            />
          ))}
          {loadingMore && (
            <div className="flex h-16 snap-start items-center justify-center" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading more posts" />
            </div>
          )}
        </section>
      )}
      {commentsPost && (
        <div className="fixed inset-0 z-50 bg-black/60 text-foreground">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Post comments"
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[78dvh] w-full max-w-2xl flex-col rounded-t-xl bg-background pb-[env(safe-area-inset-bottom)]"
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-semibold">Comments</h2>
              <button
                type="button"
                onClick={() => setCommentsPostId(null)}
                aria-label="Close comments"
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {commentsPost.comments.map((comment) => (
                <p key={comment.id} className="py-2 text-sm">
                  <span className="font-semibold">
                    {comment.author?.display_name ?? "Member"}:{" "}
                  </span>
                  {comment.body}
                </p>
              ))}
            </div>
            <form
              onSubmit={(event) => void addComment(event, commentsPost.id)}
              className="flex gap-2 border-t border-border p-3"
            >
              <input
                value={commentDrafts[commentsPost.id] ?? ""}
                onChange={(event) =>
                  setCommentDrafts((current) => ({
                    ...current,
                    [commentsPost.id]: event.target.value,
                  }))
                }
                maxLength={2000}
                aria-label="Write a comment"
                placeholder="Write a comment"
                className="min-w-0 flex-1 rounded-md bg-secondary px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={!commentDrafts[commentsPost.id]?.trim()}
                aria-label="Send comment"
                className="rounded-md p-2 text-primary disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </section>
        </div>
      )}
      {reportPostId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-foreground">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Report post"
            className="w-full max-w-sm rounded-lg bg-background p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Report post</h2>
              <button
                type="button"
                onClick={() => setReportPostId(null)}
                aria-label="Close report dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-4 block text-sm">
              Reason
              <select
                value={reportReasons[reportPostId] ?? "spam"}
                onChange={(event) =>
                  setReportReasons((current) => ({
                    ...current,
                    [reportPostId]: event.target.value as ReportReason,
                  }))
                }
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-2"
              >
                <option value="spam">Spam</option>
                <option value="harassment">Harassment</option>
                <option value="violence">Violence</option>
                <option value="sexual">Sexual content</option>
                <option value="other">Other</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void report(reportPostId);
                setReportPostId(null);
              }}
              className="h-10 w-full rounded-md bg-destructive text-destructive-foreground"
            >
              Submit report
            </button>
          </section>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
