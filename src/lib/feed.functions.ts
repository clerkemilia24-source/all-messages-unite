import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RuntimeEnvironment = Record<string, unknown>;

function getEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  return (process.env[name] ?? runtimeEnvironment?.[name]) as string | undefined;
}

async function moderatePublicContent(input: {
  body: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
}) {
  const endpoint = getEnvironmentValue("CONTENT_MODERATION_URL")?.trim();
  const apiKey = getEnvironmentValue("CONTENT_MODERATION_API_KEY")?.trim();
  if (!endpoint || !apiKey) {
    console.error("[feed] Content moderation is not configured", {
      endpointPresent: Boolean(endpoint),
      apiKeyPresent: Boolean(apiKey),
    });
    throw new Error("Publishing is paused until content moderation is configured.");
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Content moderation is unavailable. Try again later.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Content moderation is unavailable. Try again later.");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Content moderation is unavailable. Try again later.");
  }
  if (!response.ok) throw new Error("Content moderation is unavailable. Try again later.");

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Content moderation returned an invalid result.");
  }
  if (typeof result !== "object" || result === null || !("approved" in result)) {
    throw new Error("Content moderation returned an invalid result.");
  }
  if (result.approved !== true) throw new Error("This post did not pass the content safety check.");
}

const postInput = z.object({
  body: z.string().trim().max(2000).nullable(),
  mediaPath: z.string().max(512).nullable(),
  mediaType: z
    .enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ])
    .nullable(),
  visibility: z.enum(["public", "followers"]),
  repostId: z.string().uuid().nullable(),
});

export const getSocialFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        scope: z.enum(["for-you", "following", "friends", "trending"]),
        page: z.number().int().min(0).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const pageSize = 20;
    const { data: followRows, error: followsError } = await context.supabase
      .from("social_follows")
      .select("following_id")
      .eq("follower_id", context.userId);
    if (followsError) throw new Error("Could not load followed accounts.");
    const followedIds = new Set((followRows ?? []).map((row) => row.following_id));

    let friendIds: string[] = [];
    if (data.scope === "friends") {
      const { data: memberships, error: membershipsError } = await context.supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", context.userId)
        .limit(500);
      if (membershipsError) throw new Error("Could not load your contacts.");
      const conversationIds = Array.from(
        new Set((memberships ?? []).map((row) => row.conversation_id)),
      );
      if (!conversationIds.length) return [];
      const { data: members, error: membersError } = await context.supabase
        .from("conversation_members")
        .select("user_id")
        .in("conversation_id", conversationIds)
        .limit(1000);
      if (membersError) throw new Error("Could not load your contacts.");
      friendIds = Array.from(new Set((members ?? []).map((member) => member.user_id))).filter(
        (id) => id !== context.userId,
      );
      if (!friendIds.length) return [];
    }

    let query = context.supabase
      .from("social_posts")
      .select("id, author_id, body, media_path, media_type, visibility, repost_of, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.scope === "for-you" || data.scope === "trending") {
      query = query.eq("visibility", "public");
      if (data.scope === "trending") {
        const recentAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", recentAfter);
      }
    } else if (data.scope === "following") {
      query = query
        .in("visibility", ["public", "followers"])
        .in("author_id", [context.userId, ...(followRows ?? []).map((row) => row.following_id)]);
      query = query.range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    } else {
      query = query
        .in("visibility", ["public", "followers"])
        .in("author_id", friendIds)
        .range(data.page * pageSize, data.page * pageSize + pageSize - 1);
    }
    const { data: candidates, error } = await query;
    if (error) throw new Error("Could not load the feed.");
    if (!candidates?.length) return [];

    let posts = candidates;
    let viewCountMap = new Map<string, number>();
    if (data.scope === "for-you" || data.scope === "trending") {
      const candidateIds = candidates.map((post) => post.id);
      const [{ data: candidateLikes, error: likesError }, { data: counts, error: countsError }] =
        await Promise.all([
          context.supabase.from("social_post_likes").select("post_id").in("post_id", candidateIds),
          context.supabase.rpc("get_social_post_view_counts", { _post_ids: candidateIds }),
        ]);
      if (likesError || countsError) throw new Error("Could not rank feed recommendations.");
      viewCountMap = new Map((counts ?? []).map((row) => [row.post_id, Number(row.view_count)]));
      const likeCounts = new Map<string, number>();
      for (const like of candidateLikes ?? []) {
        likeCounts.set(like.post_id, (likeCounts.get(like.post_id) ?? 0) + 1);
      }
      posts = [...candidates]
        .sort((left, right) => {
          const score = (post: (typeof candidates)[number]) => {
            const ageHours = Math.max(
              0,
              (Date.now() - new Date(post.created_at).getTime()) / 3_600_000,
            );
            const views = viewCountMap.get(post.id) ?? 0;
            const likes = likeCounts.get(post.id) ?? 0;
            if (data.scope === "trending") {
              return (views * 2 + likes * 3 + 1) / Math.pow(ageHours + 1, 0.45);
            }
            const relationshipBoost = followedIds.has(post.author_id) ? 8 : 0;
            return (views + likes * 2 + relationshipBoost + 1) / Math.pow(ageHours + 6, 0.6);
          };
          return score(right) - score(left);
        })
        .slice(data.page * pageSize, data.page * pageSize + pageSize);
    }
    if (!posts.length) return [];

    const postIds = posts.map((post) => post.id);
    const authorIds = Array.from(new Set(posts.map((post) => post.author_id)));
    const repostIds = posts.map((post) => post.repost_of).filter((id): id is string => Boolean(id));
    const [
      { data: profiles },
      { data: likes },
      { data: comments },
      { data: savedPosts, error: savesError },
      originals,
    ] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", authorIds),
      context.supabase.from("social_post_likes").select("post_id, user_id").in("post_id", postIds),
      context.supabase
        .from("social_post_comments")
        .select("id, post_id, author_id, body, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true })
        .limit(500),
      context.supabase
        .from("social_post_saves")
        .select("post_id")
        .eq("user_id", context.userId)
        .in("post_id", postIds),
      repostIds.length
        ? context.supabase
            .from("social_posts")
            .select("id, author_id, body, media_path, media_type")
            .in("id", repostIds)
        : Promise.resolve({ data: [] }),
    ]);
    if (savesError) throw new Error("Could not load saved posts.");

    if (!viewCountMap.size) {
      const viewsResult = await context.supabase.rpc("get_social_post_view_counts", {
        _post_ids: postIds,
      });
      if (viewsResult.error) throw new Error("Could not load post view counts.");
      viewCountMap = new Map(
        (viewsResult.data ?? []).map((row) => [row.post_id, Number(row.view_count)]),
      );
    }

    const originalPosts = originals.data ?? [];
    const allProfiles = new Set([
      ...authorIds,
      ...(comments ?? []).map((comment) => comment.author_id),
      ...originalPosts.map((post) => post.author_id),
    ]);
    const missingProfiles = Array.from(allProfiles).filter(
      (id) => !(profiles ?? []).some((profile) => profile.id === id),
    );
    const { data: extraProfiles } = missingProfiles.length
      ? await context.supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", missingProfiles)
      : { data: [] };
    const profileMap = new Map(
      [...(profiles ?? []), ...(extraProfiles ?? [])].map((p) => [p.id, p]),
    );
    const commentGroups = new Map<string, typeof comments>();
    for (const comment of comments ?? []) {
      commentGroups.set(comment.post_id, [...(commentGroups.get(comment.post_id) ?? []), comment]);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mediaPaths = new Set<string>();
    posts.forEach((post) => post.media_path && mediaPaths.add(post.media_path));
    originalPosts.forEach((post) => post.media_path && mediaPaths.add(post.media_path));
    const signedUrls = new Map<string, string>();
    await Promise.all(
      Array.from(mediaPaths, async (path) => {
        const { data: signed } = await supabaseAdmin.storage
          .from("feed-review")
          .createSignedUrl(path, 300);
        if (signed?.signedUrl) signedUrls.set(path, signed.signedUrl);
      }),
    );

    const likeGroups = new Map<string, string[]>();
    for (const like of likes ?? []) {
      likeGroups.set(like.post_id, [...(likeGroups.get(like.post_id) ?? []), like.user_id]);
    }
    const savedPostIds = new Set((savedPosts ?? []).map((savedPost) => savedPost.post_id));
    const originalMap = new Map(originalPosts.map((post) => [post.id, post]));

    return posts.map((post) => {
      const postLikes = likeGroups.get(post.id) ?? [];
      const original = post.repost_of ? originalMap.get(post.repost_of) : undefined;
      return {
        ...post,
        author: profileMap.get(post.author_id) ?? null,
        mediaUrl: post.media_path ? (signedUrls.get(post.media_path) ?? null) : null,
        viewCount: viewCountMap.get(post.id) ?? 0,
        likeCount: postLikes.length,
        likedByMe: postLikes.includes(context.userId),
        savedByMe: savedPostIds.has(post.id),
        followingAuthor: followedIds.has(post.author_id),
        comments: (commentGroups.get(post.id) ?? []).map((comment) => ({
          ...comment,
          author: profileMap.get(comment.author_id) ?? null,
        })),
        original: original
          ? {
              ...original,
              author: profileMap.get(original.author_id) ?? null,
              mediaUrl: original.media_path ? (signedUrls.get(original.media_path) ?? null) : null,
            }
          : null,
      };
    });
  });

export const publishSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => postInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!data.body && !data.mediaPath && !data.repostId) {
      throw new Error("Add text, photo, or video before publishing.");
    }
    if (Boolean(data.mediaPath) !== Boolean(data.mediaType)) {
      throw new Error("The uploaded media is not valid for this account.");
    }
    if (data.mediaPath && (!data.mediaType || !data.mediaPath.startsWith(`${context.userId}/`))) {
      throw new Error("The uploaded media is not valid for this account.");
    }
    if (data.mediaPath?.split("/").some((part) => part === "..")) {
      throw new Error("The uploaded media path is invalid.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      let repostOf: string | null = null;
      let postVisibility = data.visibility;
      if (data.repostId) {
        const { data: original, error } = await context.supabase
          .from("social_posts")
          .select("id, visibility")
          .eq("id", data.repostId)
          .maybeSingle();
        if (error || !original) throw new Error("This post is not available to repost.");
        repostOf = original.id;
        postVisibility = original.visibility === "followers" ? "followers" : "public";
      }

      if (data.body || data.mediaPath) {
        let mediaUrl: string | null = null;
        if (data.mediaPath) {
          const { data: signed, error } = await supabaseAdmin.storage
            .from("feed-review")
            .createSignedUrl(data.mediaPath, 600);
          if (error || !signed) throw new Error("Could not prepare media for safety review.");
          mediaUrl = signed.signedUrl;
        }
        await moderatePublicContent({
          body: data.body || null,
          mediaType: data.mediaType,
          mediaUrl,
        });
      }

      const { data: post, error } = await supabaseAdmin
        .from("social_posts")
        .insert({
          author_id: context.userId,
          body: data.body || null,
          media_path: data.mediaPath,
          media_type: data.mediaType,
          visibility: postVisibility,
          moderation_status: "approved",
          repost_of: repostOf,
        })
        .select("id")
        .single();
      if (error || !post) throw new Error("Could not publish this post.");
      return { id: post.id };
    } catch (error) {
      if (data.mediaPath) {
        await supabaseAdmin.storage.from("feed-review").remove([data.mediaPath]);
      }
      throw error;
    }
  });

export const recordSocialPostView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: recorded, error } = await context.supabase.rpc("record_social_post_view", {
      _post_id: data.postId,
    });
    if (error) throw new Error("Could not record this post view.");
    return { recorded };
  });

export const addSocialComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ postId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error: postError } = await context.supabase
      .from("social_posts")
      .select("id")
      .eq("id", data.postId)
      .maybeSingle();
    if (postError || !post) throw new Error("This post is not available to comment on.");
    await moderatePublicContent({ body: data.body, mediaType: null, mediaUrl: null });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("social_post_comments").insert({
      post_id: post.id,
      author_id: context.userId,
      body: data.body,
      moderation_status: "approved",
    });
    if (error) throw new Error("Could not add this comment.");
  });

export const reportSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        postId: z.string().uuid(),
        reason: z.enum(["spam", "harassment", "violence", "sexual", "other"]),
        details: z.string().trim().max(500).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error: postError } = await context.supabase
      .from("social_posts")
      .select("id")
      .eq("id", data.postId)
      .maybeSingle();
    if (postError || !post) throw new Error("This post is not available to report.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("social_post_reports").insert({
      post_id: post.id,
      reporter_id: context.userId,
      reason: data.reason,
      details: data.details || null,
    });
    if (error?.code === "23505") return { reported: true, alreadyReported: true };
    if (error) throw new Error("Could not submit this report.");

    const { count } = await supabaseAdmin
      .from("social_post_reports")
      .select("id", { count: "exact", head: true })
      .eq("post_id", post.id);
    if ((count ?? 0) >= 3) {
      await supabaseAdmin
        .from("social_posts")
        .update({ moderation_status: "review" })
        .eq("id", post.id)
        .eq("moderation_status", "approved");
    }
    return { reported: true, alreadyReported: false };
  });
