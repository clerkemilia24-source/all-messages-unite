// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RuntimeEnvironment = Record<string, unknown>;

function getRuntimeEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  const processValue = process.env[name];
  const runtimeValue = runtimeEnvironment?.[name];
  return (processValue ?? runtimeValue) as string | undefined;
}

/**
 * Issues a short-lived LiveKit token for a call the caller is actually a member of.
 * The room name never comes from the client: it is read from the database row,
 * so guessing or reusing a room identifier cannot grant access.
 */
export const getCallToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ callId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS restricts this select to calls in conversations the user belongs to.
    const { data: call, error } = await context.supabase
      .from("call_sessions")
      .select("id, room_name, status, kind, conversation_id, initiator_id")
      .eq("id", data.callId)
      .maybeSingle();

    if (error || !call) throw new Error("You cannot join this call.");
    if (call.status === "ended" || call.status === "declined" || call.status === "missed") {
      throw new Error("This call has already ended.");
    }

    let role: "host" | "cohost" | "participant" =
      call.initiator_id === context.userId ? "host" : "participant";
    if (role !== "host") {
      const { data: cohost, error: cohostError } = await context.supabase
        .from("call_cohosts")
        .select("user_id")
        .eq("call_id", call.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (cohostError) throw new Error("Could not verify your call role.");
      if (cohost) role = "cohost";
    }

    const apiKey = getRuntimeEnvironmentValue("LIVEKIT_API_KEY")?.trim();
    const apiSecret = getRuntimeEnvironmentValue("LIVEKIT_API_SECRET")?.trim();
    const wsUrl = getRuntimeEnvironmentValue("LIVEKIT_WEBSOCKET_URL")?.trim();
    const missing = [
      !apiKey && "LIVEKIT_API_KEY",
      !apiSecret && "LIVEKIT_API_SECRET",
      !wsUrl && "LIVEKIT_WEBSOCKET_URL",
    ].filter((name): name is string => Boolean(name));
    if (missing.length) {
      console.error("[calls] LiveKit configuration is missing", { missing });
      throw new Error(`Calling is not configured: missing ${missing.join(", ")}.`);
    }
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("Calling is not configured.");
    }

    console.info("[calls] LiveKit runtime configuration detected", {
      apiKeyPresent: apiKey.length > 0,
      apiSecretPresent: apiSecret.length > 0,
      websocketUrl: wsUrl,
    });

    let liveKitUrl: URL;
    try {
      liveKitUrl = new URL(wsUrl);
    } catch {
      console.error("[calls] LiveKit URL is invalid", { wsUrl });
      throw new Error("Calling is not configured: LIVEKIT_WEBSOCKET_URL is invalid.");
    }
    if (!["ws:", "wss:"].includes(liveKitUrl.protocol)) {
      console.error("[calls] LiveKit URL must use ws or wss", {
        protocol: liveKitUrl.protocol,
      });
      throw new Error("Calling is not configured: LIVEKIT_WEBSOCKET_URL must use ws:// or wss://.");
    }

    const { AccessToken, TokenVerifier } = await import("livekit-server-sdk");
    const token = new AccessToken(apiKey, apiSecret, {
      identity: context.userId,
      ttl: 120,
    });
    token.addGrant({
      room: call.room_name,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();
    await new TokenVerifier(apiKey, apiSecret).verify(jwt);
    console.info("[calls] LiveKit token generated and verified", {
      userId: context.userId,
      callId: call.id,
      roomName: call.room_name,
      expiresInSeconds: 120,
      websocketUrl: liveKitUrl.toString(),
    });
    return {
      token: jwt,
      url: liveKitUrl.toString(),
      kind: call.kind,
      roomName: call.room_name,
      role,
    };
  });

export const setCallCohost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        callId: z.string().uuid(),
        userId: z.string().uuid(),
        isCohost: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: call, error } = await context.supabase
      .from("call_sessions")
      .select("id, conversation_id, initiator_id")
      .eq("id", data.callId)
      .maybeSingle();
    if (error || !call || call.initiator_id !== context.userId) {
      throw new Error("Only the call host can change co-host roles.");
    }

    const { data: member, error: memberError } = await context.supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", call.conversation_id)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (memberError || !member) throw new Error("Co-host must be a member of this conversation.");

    const { error: updateError } = await context.supabase.rpc("set_call_cohost", {
      _call_id: data.callId,
      _user_id: data.userId,
      _is_cohost: data.isCohost,
    });
    if (updateError) throw new Error("Could not update the co-host role.");
  });

const iceCandidateTypeSchema = z.enum(["host", "srflx", "relay", "unknown"]);

export const reportCallIceCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        callId: z.string().uuid(),
        localCandidateType: iceCandidateTypeSchema,
        remoteCandidateType: iceCandidateTypeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: call, error } = await context.supabase
      .from("call_sessions")
      .select("id, room_name")
      .eq("id", data.callId)
      .maybeSingle();

    if (error || !call) throw new Error("You cannot report diagnostics for this call.");

    const usesTurn = data.localCandidateType === "relay" || data.remoteCandidateType === "relay";
    console.info("[calls] Selected ICE candidate pair", {
      userId: context.userId,
      callId: call.id,
      roomName: call.room_name,
      localCandidateType: data.localCandidateType,
      remoteCandidateType: data.remoteCandidateType,
      route: usesTurn ? "relay" : "direct",
    });
  });
