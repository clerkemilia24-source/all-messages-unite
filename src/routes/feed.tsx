import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PanelsTopLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/feed")({
  head: () => ({ meta: [
    { title: "Feed — Ripple" },
    { name: "description", content: "Your Ripple feed." },
    { property: "og:title", content: "Feed — Ripple" },
    { property: "og:description", content: "Your Ripple feed." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: FeedPage,
});

function FeedPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) void navigate({ to: "/auth" }); }, [loading, user, navigate]);
  return <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
    <header className="liquid-panel sticky top-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"><h1 className="text-[2rem] font-bold">Feed</h1></header>
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"><PanelsTopLeft className="h-10 w-10 text-primary" /><h2 className="text-lg font-semibold">Feed is coming soon</h2><p className="text-sm text-muted-foreground">Check back for updates from your community.</p></div>
    <BottomNav />
  </main>;
}