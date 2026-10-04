// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/wallet-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expired, error } = await supabaseAdmin.rpc("expire_wallet_payment_requests");
        if (error) {
          console.error("[wallet] Payment request expiration failed", { error: error.message });
          return Response.json({ error: "request expiration failed" }, { status: 500 });
        }
        return Response.json({ expired: expired ?? 0 });
      },
    },
  },
});
