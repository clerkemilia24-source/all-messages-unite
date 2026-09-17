import { Link } from "@tanstack/react-router";
import { MessageSquare, CircleDashed, Users, Settings } from "lucide-react";

const TABS = [
  { to: "/", label: "Chat", Icon: MessageSquare, exact: true },
  { to: "/status", label: "Status", Icon: CircleDashed, exact: false },
  { to: "/contacts", label: "Contact", Icon: Users, exact: false },
  { to: "/settings", label: "Settings", Icon: Settings, exact: false },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-20 mt-auto flex shrink-0 items-stretch border-t border-border bg-chrome pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl"
    >
      {TABS.map(({ to, label, Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact }}
          activeProps={{ className: "text-primary", "aria-current": "page" }}
          inactiveProps={{ className: "text-muted-foreground" }}
          className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition active:scale-95"
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
