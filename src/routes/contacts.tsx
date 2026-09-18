import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquare, Phone, Video, PhoneCall, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isOnline } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar } from "@/components/RemoteImage";
import { findOrCreateDirect, type ProfileLite } from "@/lib/chat";
import { useCalls } from "@/lib/calls";

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts — Ripple" },
      {
        name: "description",
        content: "Your Ripple contacts with online status, quick message and call actions.",
      },
      { property: "og:title", content: "Contacts — Ripple" },
      { property: "og:description", content: "People you chat with on Ripple." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { startCall } = useCalls();
  const [contacts, setContacts] = useState<ProfileLite[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: mine } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const ids = (mine ?? []).map((m) => m.conversation_id);
    if (!ids.length) {
      setContacts([]);
      return;
    }
    const { data: rows } = await supabase
      .from("conversation_members")
      .select("user_id")
      .in("conversation_id", ids);
    const peerIds = Array.from(new Set((rows ?? []).map((r) => r.user_id))).filter(
      (id) => id !== user.id,
    );
    if (!peerIds.length) {
      setContacts([]);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, status_text, last_seen")
      .in("id", peerIds)
      .order("display_name");
    setContacts((profs ?? []) as ProfileLite[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => {
    const filtered = (contacts ?? []).filter((c) => {
      const term = q.trim().toLowerCase();
      if (!term) return true;
      return c.display_name.toLowerCase().includes(term) || c.username.toLowerCase().includes(term);
    });
    const map = new Map<string, ProfileLite[]>();
    filtered.forEach((c) => {
      const letter = (c.display_name[0] ?? "#").toUpperCase();
      const list = map.get(letter) ?? [];
      list.push(c);
      map.set(letter, list);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [contacts, q]);

  async function openChat(otherId: string) {
    if (!user) return;
    try {
      const id = await findOrCreateDirect(user.id, otherId);
      void navigate({ to: "/chat/$id", params: { id } });
    } catch {
      toast.error("That chat could not be opened.");
    }
  }

  async function call(otherId: string, kind: "audio" | "video", name: string) {
    if (!user) return;
    try {
      const conversationId = await findOrCreateDirect(user.id, otherId);
      await startCall(conversationId, kind, name);
    } catch {
      toast.error("The call could not be started.");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-chrome px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <h1 className="text-[2rem] font-bold tracking-tight text-foreground">Contacts</h1>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts"
            aria-label="Search contacts"
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </header>

      <Link
        to="/calls"
        className="flex items-center gap-3 border-b border-border px-4 py-3 transition active:bg-secondary"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
          <PhoneCall className="h-5 w-5" />
        </span>
        <span className="text-[17px] font-semibold text-foreground">Call history</span>
      </Link>

      {contacts === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="text-lg font-semibold text-foreground">No contacts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            People appear here once you start a chat with them.
          </p>
        </div>
      ) : (
        <div className="flex-1">
          {sections.map(([letter, people]) => (
            <section key={letter}>
              <h2 className="bg-secondary px-4 py-1 text-[13px] font-semibold text-muted-foreground">
                {letter}
              </h2>
              <ul className="divide-y divide-border">
                {people.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      onClick={() => void openChat(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ChatAvatar
                        name={c.display_name}
                        path={c.avatar_url}
                        size={46}
                        online={isOnline(c.last_seen)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-semibold text-foreground">
                          {c.display_name}
                        </span>
                        <span className="block truncate text-[15px] text-muted-foreground">
                          {c.status_text || `@${c.username}`}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => void openChat(c.id)}
                      aria-label={`Message ${c.display_name}`}
                      className="p-2 text-primary"
                    >
                      <MessageSquare className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => void call(c.id, "audio", c.display_name)}
                      aria-label={`Voice call ${c.display_name}`}
                      className="p-2 text-primary"
                    >
                      <Phone className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => void call(c.id, "video", c.display_name)}
                      aria-label={`Video call ${c.display_name}`}
                      className="p-2 text-primary"
                    >
                      <Video className="h-5 w-5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
