import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function cleanup() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: expired, error } = await supabaseAdmin
    .from("status_posts")
    .select("id, media_url")
    .lt("expires_at", new Date().toISOString())
    .limit(500);

  if (error) return new Response(JSON.stringify({ error: "lookup failed" }), { status: 500 });
  if (!expired || expired.length === 0) return Response.json({ removed: 0 });

  const paths = expired.map((p) => p.media_url).filter((p): p is string => !!p);
  let mediaRemoved = 0;
  const failedPaths: string[] = [];

  if (paths.length) {
    const { data: removed, error: storageError } = await supabaseAdmin.storage
      .from("status")
      .remove(paths);
    if (storageError) failedPaths.push(...paths);
    else {
      mediaRemoved = removed?.length ?? 0;
      const ok = new Set((removed ?? []).map((r) => r.name));
      failedPaths.push(...paths.filter((p) => !ok.has(p)));
    }
  }

  // Only drop rows whose media is really gone, so failed deletions are retried
  // on the next run instead of leaking orphaned files.
  const deletable = expired
    .filter((p) => !p.media_url || !failedPaths.includes(p.media_url))
    .map((p) => p.id);

  if (deletable.length) {
    await supabaseAdmin.from("status_posts").delete().in("id", deletable);
  }

  return Response.json({ removed: deletable.length, mediaRemoved, retrying: failedPaths.length });
}

export const Route = createFileRoute("/api/public/cron/status-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        return cleanup();
      },
      GET: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        return cleanup();
      },
    },
  },
});
