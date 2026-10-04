// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RuntimeEnvironment = Record<string, unknown>;

function getRuntimeEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  return (process.env[name] ?? runtimeEnvironment?.[name]) as string | undefined;
}

function getLiveKitConfiguration() {
  const apiKey = getRuntimeEnvironmentValue("LIVEKIT_API_KEY")?.trim();
  const apiSecret = getRuntimeEnvironmentValue("LIVEKIT_API_SECRET")?.trim();
  const websocketUrl = getRuntimeEnvironmentValue("LIVEKIT_WEBSOCKET_URL")?.trim();
  if (!apiKey || !apiSecret || !websocketUrl) {
    throw new Error("LIVE broadcasting is not configured on this server.");
  }

  let url: URL;
  try {
    url = new URL(websocketUrl);
  } catch {
    throw new Error("LIVE broadcasting has an invalid server URL.");
  }
  if (!(["ws:", "wss:"] as string[]).includes(url.protocol)) {
    throw new Error("LIVE broadcasting requires a ws:// or wss:// server URL.");
  }
  return { apiKey, apiSecret, websocketUrl: url.toString() };
}

export const createLiveStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ title: z.string().trim().min(2).max(160) }).parse(input))
  .handler(async ({ data, context }) => {
    getLiveKitConfiguration();
    const { data: stream, error } = await context.supabase
      .from("live_streams")
      .insert({
        host_id: context.userId,
        title: data.title,
        room_name: `live-${crypto.randomUUID()}`,
      })
      .select("id, title, status")
      .single();
    if (error || !stream) {
      if (error?.code === "23505") throw new Error("You already have a LIVE session in progress.");
      throw new Error("Could not create your LIVE session.");
    }
    return stream;
  });

export const getLiveStreams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: streams, error } = await context.supabase
      .from("live_streams")
      .select("id, host_id, title, status, created_at, started_at")
      .eq("status", "live")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load live streams.");
    if (!streams?.length) return [];
    const hostIds = Array.from(new Set(streams.map((stream) => stream.host_id)));
    const { data: profiles, error: profilesError } = await context.supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", hostIds);
    if (profilesError) throw new Error("Could not load LIVE creator profiles.");
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return streams.map((stream) => ({ ...stream, host: profileMap.get(stream.host_id) ?? null }));
  });

export const getLiveStreamToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ streamId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: stream, error } = await context.supabase
      .from("live_streams")
      .select("id, host_id, room_name, status")
      .eq("id", data.streamId)
      .maybeSingle();
    if (error || !stream) throw new Error("This LIVE stream is not available.");
    const isHost = stream.host_id === context.userId;
    if (stream.status !== "live" && !(isHost && stream.status === "starting")) {
      throw new Error("This LIVE stream has ended.");
    }

    const { apiKey, apiSecret, websocketUrl } = getLiveKitConfiguration();
    const { AccessToken, TokenVerifier } = await import("livekit-server-sdk");
    const token = new AccessToken(apiKey, apiSecret, {
      identity: context.userId,
      ttl: 300,
    });
    token.addGrant({
      room: stream.room_name,
      roomJoin: true,
      canPublish: isHost,
      canSubscribe: true,
      canPublishData: isHost,
    });
    const jwt = await token.toJwt();
    await new TokenVerifier(apiKey, apiSecret).verify(jwt);
    return { token: jwt, url: websocketUrl, isHost };
  });

export const setLiveStreamStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ streamId: z.string().uuid(), status: z.enum(["live", "ended"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: changed, error } = await context.supabase.rpc("set_live_stream_status", {
      _stream_id: data.streamId,
      _next_status: data.status,
    });
    if (error || !changed) throw new Error("The LIVE session could not change state.");
    return { status: data.status };
  });
