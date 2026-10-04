// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function cleanupReservations() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: released, error } = await supabaseAdmin.rpc("release_expired_shop_reservations");
  if (error) {
    console.error("[shop] Reservation cleanup failed", { error: error.message });
    return Response.json({ error: "reservation cleanup failed" }, { status: 500 });
  }
  return Response.json({ released: released ?? 0 });
}

export const Route = createFileRoute("/api/public/cron/shop-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        return cleanupReservations();
      },
    },
  },
});
