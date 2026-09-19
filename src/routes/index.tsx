import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Search, SquarePen, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isOnline } from "@/lib/auth";
import { ChatAvatar } from "@/components/RemoteImage";
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { searchMessages } from '@/lib/search.functions';
import { Button } from '@/components/ui/button';
import {
  loadConversations,
  conversationTitle,
  previewText,
  formatListTime,
  type ConversationSummary,
} from "@/lib/chat";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Messages — Ripple" },
      {
        name: "description",
        content:
          "All your conversations in one place: tapbacks, photos, group chats, typing indicators and read receipts.",
      },
      { property: "og:title", content: "Messages — Ripple" },
      { property: "og:description", content: "All your conversations in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Inbox,
});

function Inbox() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const runSearch = useServerFn(searchMessages);
  useEffect(() => { const timer = setTimeout(() => { setSearch(q.trim()); setPage(0); }, 300); return () => clearTimeout(timer); }, [q]);
  const results = useQuery({ queryKey: ['message-search', user?.id, search, page], queryFn: () => runSearch({ data: { query: search, page } }), enabled: !!user && !!search });

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setItems(await loadConversations(user.id));
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  const filtered = (items ?? []).filter((c) => {
    if (!q.trim()) return true;
    const t = conversationTitle(c).toLowerCase();
    return t.includes(q.toLowerCase()) || previewText(c.lastMessage).toLowerCase().includes(q.toLowerCase());
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-chrome px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-end justify-between">
          <h1 className="text-[2rem] font-bold tracking-tight text-foreground">Messages</h1>
          <div className="flex items-center gap-2 pb-1.5">
            <Link
              to="/profile"
              aria-label="Your profile"
              className="rounded-full transition active:scale-95"
            >
              <ChatAvatar
                name={profile?.display_name ?? "Me"}
                path={profile?.avatar_url}
                size={32}
              />
            </Link>
            <Link
              to="/new"
              aria-label="New message"
              className="flex h-9 w-9 items-center justify-center rounded-full text-primary transition active:scale-95"
            >
              <SquarePen className="h-6 w-6" />
            </Link>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search chats and messages"
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </header>

      {search && <section className="border-b border-border px-4 py-3" aria-label="Message search results">
        <h2 className="mb-2 text-sm font-semibold">Messages</h2>
        {results.isFetching ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Searching messages" /> : results.isError ? <p role="alert">Search failed. <Button variant="link" onClick={() => void results.refetch()}>Try again</Button></p> : <ul className="divide-y divide-border">{results.data?.messages.map(m => <li key={m.id}><Link to="/chat/$id" params={{ id: m.conversation_id }} search={{ message: m.id }} className="block py-3"><p className="text-sm font-semibold">{items?.find(c => c.id === m.conversation_id) ? conversationTitle(items.find(c => c.id === m.conversation_id) as ConversationSummary) : 'Conversation'}</p><p className="line-clamp-2 break-words text-sm text-muted-foreground">{m.body}</p></Link></li>)}</ul>}
        {!results.isFetching && results.data?.messages.length === 0 && <p className="text-sm text-muted-foreground">No matching messages</p>}
        <div className="flex justify-between">{page > 0 && <Button variant="ghost" onClick={() => setPage(p => p - 1)}>Previous</Button>}{results.data?.hasMore && <Button variant="ghost" onClick={() => setPage(p => p + 1)}>Next</Button>}</div>
      </section>}

      {items === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="text-lg font-semibold text-foreground">
            {q.trim() ? "No matching chats" : "No conversations yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.trim()
              ? "Try a different name or word."
              : "Start a chat with someone by their username."}
          </p>
          {!q.trim() && (
            <Link
              to="/new"
              className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              New message
            </Link>
          )}
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {filtered.map((c) => {
            const other = c.others[0];
            return (
              <li key={c.id}>
                <Link
                  to="/chat/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-3 px-4 py-2.5 transition active:bg-secondary"
                >
                  <span className="flex w-2 justify-center">
                    {c.unread > 0 && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <ChatAvatar
                    name={conversationTitle(c)}
                    path={c.is_group ? null : other?.avatar_url}
                    size={50}
                    online={!c.is_group && isOnline(other?.last_seen)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[17px] font-semibold text-foreground">
                        {conversationTitle(c)}
                      </p>
                      <span className="shrink-0 text-[13px] text-muted-foreground">
                        {c.lastMessage ? formatListTime(c.lastMessage.created_at) : ""}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[15px] leading-snug text-muted-foreground">
                      {previewText(c.lastMessage)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
