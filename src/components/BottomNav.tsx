import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageSquare, CircleDashed, Wallet, PanelsTopLeft, ShoppingBag } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { loadConversations } from "@/lib/chat";

const TABS = [
  { to: "/", label: "Chat", Icon: MessageSquare, exact: true },
  { to: "/status", label: "Status", Icon: CircleDashed, exact: false },
  { to: "/wallet", label: "Wallet", Icon: Wallet, exact: false },
  { to: "/feed", label: "Feed", Icon: PanelsTopLeft, exact: false },
  { to: "/shop", label: "Shop", Icon: ShoppingBag, exact: false },
] as const;

export function BottomNav() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const conversations = await loadConversations(user.id);
        if (active) {
          setUnreadCount(
            conversations.reduce((total, conversation) => total + conversation.unread, 0),
          );
        }
      } catch {
        if (active) setUnreadCount(0);
      }
    };
    const channel = supabase
      .channel(`nav-unread-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members" },
        () => void refresh(),
      )
      .subscribe();
    void refresh();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <nav aria-label="Primary" className="liquid-chrome grid shrink-0 grid-cols-5 gap-1 p-1.5">
      {TABS.map(({ to, label, Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact }}
          activeProps={{ className: "nav-active", "aria-current": "page" }}
          className="relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-semibold active:scale-95 sm:text-[11px]"
          aria-label={label === "Chat" && unreadCount > 0 ? `Chat, ${unreadCount} unread` : label}
        >
          <span className="relative">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
            {label === "Chat" && unreadCount > 0 && (
              <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-background bg-danger px-1 text-[9px] leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
