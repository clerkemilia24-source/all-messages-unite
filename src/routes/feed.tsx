import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Flag,
  Globe2,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Repeat2,
  Send,
  Share2,
  UserRoundPlus,
  Users,
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

type FeedScope = "public" | "following";
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

function FeedPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<FeedScope>("public");
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [publishing, setPublishing] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reportReasons, setReportReasons] = useState<Record<string, ReportReason>>({});

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setPosts(await getSocialFeed({ data: { scope } }));
    } catch (error) {
      console.error("[feed] Could not load posts", error);
      toast.error("Could not load the feed.");
      setPosts([]);
    }
  }, [scope, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    else await refresh();
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
    else await refresh();
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="liquid-panel sticky top-0 z-20 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold">Feed</h1>
        <Globe2 className="h-5 w-5 text-primary" aria-hidden="true" />
      </header>

      <div className="sticky top-[4.25rem] z-10 flex border-b border-border bg-background/90 px-4 backdrop-blur">
        {(["public", "following"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setScope(item)}
            aria-pressed={scope === item}
            className={`flex-1 border-b-2 py-3 text-sm font-medium capitalize ${scope === item ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {item === "public" ? "Public" : "Following"}
          </button>
        ))}
      </div>

      <section className="border-b border-border px-4 py-4">
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
              <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">
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
                onChange={(event) => setVisibility(event.target.value as "public" | "followers")}
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
        <section aria-label="Posts" className="flex-1 divide-y divide-border">
          {posts.map((post) => (
            <article id={`post-${post.id}`} key={post.id} className="px-4 py-4">
              <header className="flex items-center gap-3">
                <ChatAvatar
                  name={post.author?.display_name ?? "Someone"}
                  path={post.author?.avatar_url ?? null}
                  size={42}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {post.author?.display_name ?? "Someone"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @{post.author?.username ?? "member"} · {formatListTime(post.created_at)}
                    {post.visibility === "followers" ? " · Followers" : ""}
                  </p>
                </div>
                {post.author_id !== user?.id && (
                  <button
                    onClick={() => void toggleFollow(post)}
                    title={post.followingAuthor ? "Unfollow" : "Follow"}
                    aria-label={post.followingAuthor ? "Unfollow author" : "Follow author"}
                    className="rounded-md p-2 text-primary hover:bg-secondary"
                  >
                    <UserRoundPlus className="h-5 w-5" />
                  </button>
                )}
              </header>
              {post.body && (
                <p className="whitespace-pre-wrap break-words py-3 text-[15px]">{post.body}</p>
              )}
              {post.mediaUrl && post.media_type?.startsWith("image/") && (
                <img
                  src={post.mediaUrl}
                  alt="Photo shared in the feed"
                  loading="lazy"
                  className="max-h-[34rem] w-full rounded-md bg-secondary object-contain"
                />
              )}
              {post.mediaUrl && post.media_type?.startsWith("video/") && (
                <video
                  src={post.mediaUrl}
                  controls
                  preload="metadata"
                  className="max-h-[34rem] w-full rounded-md bg-black"
                />
              )}
              {post.repost_of && (
                <div className="mt-3 border-l-2 border-primary pl-3 text-sm">
                  {post.original ? (
                    <>
                      <p className="mb-1 text-xs text-muted-foreground">
                        {post.original.author?.display_name ?? "Member"}
                      </p>
                      {post.original.body && <p>{post.original.body}</p>}
                      {post.original.mediaUrl && post.original.media_type?.startsWith("image/") && (
                        <img
                          src={post.original.mediaUrl}
                          alt="Reposted photo"
                          className="mt-2 max-h-72 rounded-md"
                        />
                      )}
                      {post.original.mediaUrl && post.original.media_type?.startsWith("video/") && (
                        <video
                          src={post.original.mediaUrl}
                          controls
                          preload="metadata"
                          className="mt-2 max-h-72 w-full rounded-md bg-black"
                        />
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">Reposted a post</p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1 pt-3">
                <button
                  onClick={() => void toggleLike(post)}
                  aria-label={post.likedByMe ? "Unlike post" : "Like post"}
                  className={`flex items-center gap-1 rounded-md px-2 py-2 text-sm ${post.likedByMe ? "text-rose-600" : "text-muted-foreground"}`}
                >
                  <Heart className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} />
                  {post.likeCount}
                </button>
                <button
                  onClick={() => document.getElementById(`comment-${post.id}`)?.focus()}
                  aria-label="Comment on post"
                  className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted-foreground"
                >
                  <MessageCircle className="h-4 w-4" />
                  {post.comments.length}
                </button>
                <button
                  onClick={() => void repost(post)}
                  aria-label="Repost"
                  className="rounded-md p-2 text-muted-foreground"
                >
                  <Repeat2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => void share(post.id)}
                  aria-label="Share post"
                  className="rounded-md p-2 text-muted-foreground"
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <select
                    value={reportReasons[post.id] ?? "spam"}
                    onChange={(event) =>
                      setReportReasons((current) => ({
                        ...current,
                        [post.id]: event.target.value as ReportReason,
                      }))
                    }
                    aria-label="Report reason"
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                  >
                    <option value="spam">Spam</option>
                    <option value="harassment">Harassment</option>
                    <option value="violence">Violence</option>
                    <option value="sexual">Sexual content</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={() => void report(post.id)}
                    aria-label="Report post"
                    title="Report post"
                    className="rounded-md p-2 text-muted-foreground"
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {post.comments.map((comment) => (
                <p key={comment.id} className="py-1 text-sm">
                  <span className="font-semibold">
                    {comment.author?.display_name ?? "Member"}:{" "}
                  </span>
                  {comment.body}
                </p>
              ))}
              <form
                onSubmit={(event) => void addComment(event, post.id)}
                className="mt-2 flex gap-2"
              >
                <input
                  id={`comment-${post.id}`}
                  value={commentDrafts[post.id] ?? ""}
                  onChange={(event) =>
                    setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))
                  }
                  maxLength={2000}
                  aria-label="Write a comment"
                  placeholder="Write a comment"
                  className="min-w-0 flex-1 rounded-md bg-secondary px-3 py-2 text-sm outline-none"
                />
                <button
                  type="submit"
                  disabled={!commentDrafts[post.id]?.trim()}
                  aria-label="Send comment"
                  className="rounded-md p-2 text-primary disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </article>
          ))}
        </section>
      )}
      <BottomNav />
    </main>
  );
}
