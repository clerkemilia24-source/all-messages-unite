import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      .select("id, room_name, status, kind, conversation_id")
      .eq("id", data.callId)
      .maybeSingle();

    if (error || !call) throw new Error("You cannot join this call.");
    if (call.status === "ended" || call.status === "declined" || call.status === "missed") {
      throw new Error("This call has already ended.");
    }

    const apiKey = process.env["LIVEKIT_API_KEY"];
    const apiSecret = process.env["LIVEKIT_API_SECRET"];
    const wsUrl = process.env["LIVEKIT_WEBSOCKET_URL"];
    if (!apiKey || !apiSecret || !wsUrl) throw new Error("Calling is not configured.");

    const { AccessToken } = await import("livekit-server-sdk");
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

    return { token: await token.toJwt(), url: wsUrl, kind: call.kind, roomName: call.room_name };
  });
