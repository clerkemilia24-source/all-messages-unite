import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar } from "@/components/RemoteImage";
import { formatListTime, type ProfileLite } from "@/lib/chat";
import { useCalls, type CallRow } from "@/lib/calls";

export const Route = createFileRoute("/calls")({
  head: () => ({
    meta: [
      { title: "Call history — Ripple" },
      { name: "description", content: "Your incoming, outgoing and missed Ripple calls." },
      { property: "og:title", content: "Call history — Ripple" },
      { property: "og:description", content: "Incoming, outgoing and missed calls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CallsPage,
});

function CallsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { startCall } = useCalls();
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [peers, setPeers] = useState<Map<string, ProfileLite[]>>(new Map());

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("call_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = (data ?? []) as CallRow[];
    setCalls(rows);

    const convIds = Array.from(new Set(rows.map((r) => r.conversation_id)));
    if (!convIds.length) return;
    const { data: members } = await supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", convIds);
    const peerIds = Array.from(
      new Set((members ?? []).map((m) => m.user_id).filter((id) => id !== user.id)),
    );
    if (!peerIds.length) return;
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, status_text, last_seen")
      .in("id", peerIds);
    const profMap = new Map((profs ?? []).map((p) => [p.id, p as ProfileLite]));
    const byConv = new Map<string, ProfileLite[]>();
    (members ?? []).forEach((m) => {
      if (m.user_id === user.id) return;
      const p = profMap.get(m.user_id);
      if (!p) return;
      const list = byConv.get(m.conversation_id) ?? [];
      list.push(p);
      byConv.set(m.conversation_id, list);
    });
    setPeers(byConv);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("call-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "call_sessions" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, load]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-chrome px-2 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <Link to="/contacts" aria-label="Back to contacts" className="p-2 text-primary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Calls</h1>
      </header>

      {calls === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="text-lg font-semibold text-foreground">No calls yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Voice and video calls you make or receive appear here.
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {calls.map((c) => {
            const others = peers.get(c.conversation_id) ?? [];
            const name = others.map((o) => o.display_name).join(", ") || "Conversation";
            const outgoing = c.initiator_id === user?.id;
            const missed = c.status === "missed" || (c.status === "declined" && !outgoing);
            const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <ChatAvatar name={name} path={others[0]?.avatar_url} size={46} />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      missed
                        ? "truncate text-[17px] font-semibold text-destructive"
                        : "truncate text-[17px] font-semibold text-foreground"
                    }
                  >
                    {name}
                  </p>
                  <p className="flex items-center gap-1 text-[15px] text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {missed ? "Missed" : outgoing ? "Outgoing" : "Incoming"} ·{" "}
                    {formatListTime(c.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => void startCall(c.conversation_id, c.kind, name)}
                  aria-label={`Call ${name} back`}
                  className="p-2 text-primary"
                >
                  {c.kind === "video" ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BottomNav />
    </main>
  );
}
