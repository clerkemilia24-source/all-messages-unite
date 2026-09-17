import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-side enforcement of the 24 hour status lifetime: removes the stored
 * media first and only then the row, so a failed media delete is retried on the
 * next sweep instead of leaving an orphaned file behind.
 */
export const sweepExpiredStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: expired } = await supabaseAdmin
      .from("status_posts")
      .select("id, media_url")
      .lt("expires_at", new Date().toISOString())
      .limit(100);

    if (!expired || expired.length === 0) return { removed: 0 };

    const paths = expired.map((p) => p.media_url).filter((p): p is string => !!p);
    const failed = new Set<string>();
    if (paths.length) {
      const { data: removed, error } = await supabaseAdmin.storage.from("status").remove(paths);
      if (error) paths.forEach((p) => failed.add(p));
      else {
        const ok = new Set((removed ?? []).map((r) => r.name));
        paths.filter((p) => !ok.has(p)).forEach((p) => failed.add(p));
      }
    }

    const deletable = expired
      .filter((p) => !p.media_url || !failed.has(p.media_url))
      .map((p) => p.id);
    if (deletable.length) await supabaseAdmin.from("status_posts").delete().in("id", deletable);

    return { removed: deletable.length };
  });
