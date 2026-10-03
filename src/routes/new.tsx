import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Check, Users, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isOnline } from "@/lib/auth";
import { ChatAvatar } from "@/components/RemoteImage";
import { createConversation, findOrCreateDirect, type ProfileLite } from "@/lib/chat";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New message — Ripple" },
      { name: "description", content: "Start a new one-to-one chat or create a group conversation." },
      { property: "og:title", content: "New message — Ripple" },
      { property: "og:description", content: "Start a new chat or create a group." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewChat,
});

function NewChat() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProfileLite[]>([]);
  const [selected, setSelected] = useState<ProfileLite[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const t = setTimeout(async () => {
      let query = supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, status_text, last_seen")
        .neq("id", user.id)
        .limit(25);
      if (q.trim()) {
        query = query.or(`username.ilike.%${q.trim()}%,display_name.ilike.%${q.trim()}%`);
      }
      const { data } = await query;
      if (active) setResults((data ?? []) as ProfileLite[]);
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, user]);

  const toggle = (p: ProfileLite) => {
    setSelected((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));
  };

  const start = async () => {
    if (!user || selected.length === 0) return;
    setBusy(true);
    try {
      const id =
        selected.length === 1
          ? await findOrCreateDirect(user.id, selected[0]!.id)
          : await createConversation(
              user.id,
              selected.map((s) => s.id),
              true,
              groupName.trim() || null,
            );
      await navigate({ to: "/chat/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the chat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="liquid-panel sticky top-0 z-10 px-2 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center text-primary">
            <ChevronLeft className="h-6 w-6" />
            <span className="text-[17px]">Cancel</span>
          </Link>
          <p className="text-[17px] font-semibold text-foreground">New Message</p>
          <Button variant="ghost"
            onClick={start}
            disabled={selected.length === 0 || busy}
            className="px-3 text-[17px] font-semibold text-primary disabled:text-muted-foreground"
          >
            Start
          </Button>
        </div>
        <div className="mt-2 px-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] text-muted-foreground">To:</span>
            {selected.map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s)}
                className="rounded-full bg-primary/12 px-2.5 py-1 text-[14px] font-medium text-primary"
              >
                {s.display_name} ×
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or username"
              className="min-w-[8rem] flex-1 bg-transparent py-1 text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          {selected.length > 1 && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (optional)"
              className="mt-2 w-full rounded-lg bg-secondary px-3 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          )}
        </div>
      </header>

      <Link
        to="/contacts"
        className="flex min-h-14 items-center gap-3 border-b border-border px-4 text-primary transition active:bg-secondary"
      >
        <Users className="h-5 w-5" aria-hidden="true" />
        <span className="flex-1 text-[16px] font-semibold">Contacts</span>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </Link>

      <ul className="flex-1 divide-y divide-border">
        {results.map((p) => {
          const on = selected.some((s) => s.id === p.id);
          return (
            <li key={p.id}>
              <button
                onClick={() => toggle(p)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-secondary"
              >
                <ChatAvatar name={p.display_name} path={p.avatar_url} size={44} online={isOnline(p.last_seen)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] text-foreground">{p.display_name}</p>
                  <p className="truncate text-[14px] text-muted-foreground">
                    @{p.username}
                    {p.status_text ? ` · ${p.status_text}` : ""}
                  </p>
                </div>
                {on && <Check className="h-5 w-5 text-primary" />}
              </button>
            </li>
          );
        })}
        {results.length === 0 && (
          <li className="px-6 py-10 text-center text-sm text-muted-foreground">
            No people found. Invite a friend to sign up and search their username.
          </li>
        )}
      </ul>
      <BottomNav />
    </main>
  );
}
