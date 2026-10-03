import { Link } from "@tanstack/react-router";
import { MessageSquare, CircleDashed, Wallet, Settings, PanelsTopLeft, ShoppingBag } from "lucide-react";

const TABS = [
  { to: "/", label: "Chat", Icon: MessageSquare, exact: true },
  { to: "/status", label: "Status", Icon: CircleDashed, exact: false },
  { to: "/wallet", label: "Wallet", Icon: Wallet, exact: false },
  { to: "/feed", label: "Feed", Icon: PanelsTopLeft, exact: false },
  { to: "/shop", label: "Shop", Icon: ShoppingBag, exact: false },
  { to: "/settings", label: "Settings", Icon: Settings, exact: false },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="liquid-chrome sticky bottom-0 z-20 mt-auto grid shrink-0 grid-cols-6 rounded-t-[24px] border-b-0 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2 shadow-lg"
    >
      {TABS.map(({ to, label, Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact }}
          activeProps={{ className: "text-primary bg-primary/10", "aria-current": "page" }}
          inactiveProps={{ className: "text-muted-foreground" }}
          className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[24px] py-1.5 text-[10px] font-semibold transition active:scale-95 sm:text-[11px]"
        >
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
