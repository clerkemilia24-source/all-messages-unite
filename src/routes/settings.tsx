import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Accessibility,
  Archive,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Coins,
  Eye,
  Gauge,
  Image,
  Info,
  LogOut,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  ShieldCheck,
  Smartphone,
  Type,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ChatAvatar } from "@/components/RemoteImage";
import { BottomNav } from "@/components/BottomNav";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getMissingFirebaseConfiguration,
  registerFirebaseDevice,
  unregisterFirebaseDevice,
} from "@/lib/push-notifications";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ripple" },
      {
        name: "description",
        content:
          "Control your privacy: read receipts, last seen, profile photo and status visibility.",
      },
      { property: "og:title", content: "Settings — Ripple" },
      {
        property: "og:description",
        content: "Privacy and account settings for your Ripple profile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type SettingsHue = "social" | "money" | "system" | "safety";
type PrivacyKey = "read_receipts" | "last_seen_visible" | "photo_visible" | "status_visible";

const TILE_HUES: Record<SettingsHue, string> = {
  social: "from-cyan-400 to-sky-600 text-white",
  money: "from-amber-300 to-amber-500 text-slate-950",
  system: "from-indigo-400 to-indigo-700 text-white",
  safety: "from-rose-400 to-rose-600 text-white",
};

const TOGGLES: {
  key: PrivacyKey;
  label: string;
  hint: string;
  Icon: LucideIcon;
  hue: SettingsHue;
}[] = [
  {
    key: "read_receipts",
    label: "Read receipts",
    hint: "Let others see when you've read their messages.",
    Icon: ShieldCheck,
    hue: "safety",
  },
  {
    key: "last_seen_visible",
    label: "Last seen & online",
    hint: "Show when you were last active.",
    Icon: Eye,
    hue: "safety",
  },
  {
    key: "photo_visible",
    label: "Profile photo",
    hint: "Show your photo to people you chat with.",
    Icon: Image,
    hue: "safety",
  },
  {
    key: "status_visible",
    label: "Status updates",
    hint: "Let your chats see your status posts.",
    Icon: CircleDashed,
    hue: "social",
  },
];

function SettingsIcon({ Icon, hue }: { Icon: LucideIcon; hue: SettingsHue }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${TILE_HUES[hue]}`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </span>
  );
}

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id}>
      <div className="px-2 pb-2">
        <p className="text-[11px] font-bold uppercase text-ink-tertiary">{title}</p>
        <p className="mt-0.5 text-[12px] text-ink-tertiary">{description}</p>
      </div>
      <div className="overflow-hidden rounded-[20px] border border-border bg-card">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  hint,
  Icon,
  hue,
  children,
}: {
  label: string;
  hint?: string;
  Icon: LucideIcon;
  hue: SettingsHue;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <SettingsIcon Icon={Icon} hue={hue} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-foreground">{label}</span>
        {hint && <span className="block text-[12px] text-ink-tertiary">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function SettingsPage() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<PrivacyKey, boolean> | null>(null);
  const [busy, setBusy] = useState<PrivacyKey | null>(null);
  const [pushState, setPushState] = useState<
    "loading" | "disabled" | "registered" | "blocked" | "unsupported" | "error"
  >(user ? "loading" : "disabled");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("read_receipts, last_seen_visible, photo_visible, status_visible")
        .eq("id", user.id)
        .maybeSingle();
      setValues({
        read_receipts: data?.read_receipts ?? true,
        last_seen_visible: data?.last_seen_visible ?? true,
        photo_visible: data?.photo_visible ?? true,
        status_visible: data?.status_visible ?? true,
      });
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const missing = getMissingFirebaseConfiguration();
    if (missing.length) {
      setPushState("error");
      setPushError(`Missing Firebase web config: ${missing.join(", ")}`);
      return;
    }
    if (!("Notification" in window)) {
      setPushState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushState("blocked");
      return;
    }
    if (Notification.permission !== "granted") {
      setPushState("disabled");
      return;
    }
    void registerFirebaseDevice(user.id)
      .then(() => {
        if (active) {
          setPushState("registered");
          setPushError(null);
        }
      })
      .catch((error) => {
        if (!active) return;
        setPushState("error");
        setPushError(error instanceof Error ? error.message : "Push registration failed.");
      });
    return () => {
      active = false;
    };
  }, [user]);

  const toggle = async (key: PrivacyKey, next: boolean) => {
    if (!user || !values) return;
    const previous = values[key];
    setValues({ ...values, [key]: next });
    setBusy(key);
    const patch =
      key === "read_receipts"
        ? { read_receipts: next }
        : key === "last_seen_visible"
          ? { last_seen_visible: next }
          : key === "photo_visible"
            ? { photo_visible: next }
            : { status_visible: next };
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    setBusy(null);
    if (error) {
      setValues({ ...values, [key]: previous });
      toast.error("That setting could not be saved");
      return;
    }
    await refreshProfile();
  };

  const togglePush = async () => {
    if (!user) return;
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushState === "registered") {
        await unregisterFirebaseDevice(user.id);
        setPushState("disabled");
        toast.success("This device registration was removed");
      } else {
        await registerFirebaseDevice(user.id);
        setPushState("registered");
        toast.success("This device is registered for push");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Push settings could not be changed.";
      setPushError(message);
      setPushState("error");
      toast.error(message);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="liquid-panel sticky top-0 z-10 flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-[2rem] font-bold text-foreground">Settings</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings options">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void navigate({ to: "/new" })}>
              New Group
            </DropdownMenuItem>
            <DropdownMenuItem disabled>New Broadcast</DropdownMenuItem>
            <DropdownMenuItem disabled>Linked Devices</DropdownMenuItem>
            <DropdownMenuItem disabled>Starred</DropdownMenuItem>
            <DropdownMenuItem disabled>Read All</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                document.getElementById("settings-sections")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div id="settings-sections" className="flex-1 space-y-3 px-4 py-4">
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3 transition active:scale-[0.99]"
        >
          <ChatAvatar name={profile?.display_name ?? "Me"} path={profile?.avatar_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-foreground">
              {profile?.display_name ?? "Your profile"}
            </p>
            <p className="truncate text-[14px] text-muted-foreground">
              {profile?.status_text ?? `@${profile?.username ?? ""}`}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        <SettingsSection title="Account" description="Manage your profile and account activity.">
          <Link to="/contacts" className="block text-foreground">
            <SettingsRow
              label="Contacts"
              hint="Find people to chat with"
              Icon={UsersRound}
              hue="social"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </SettingsRow>
          </Link>
          <div className="h-px bg-border" />
          <Link to="/calls" className="block text-foreground">
            <SettingsRow
              label="Call history"
              hint="Recent voice and video calls"
              Icon={PhoneCall}
              hue="social"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </SettingsRow>
          </Link>
          <div className="h-px bg-border" />
          <Link to="/wallet" className="block text-foreground">
            <SettingsRow
              label="Wallet"
              hint="Balance and payment activity"
              Icon={Wallet}
              hue="money"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </SettingsRow>
          </Link>
          <div className="h-px bg-border" />
          <Link to="/coin" className="block text-foreground">
            <SettingsRow
              label="Native Coin"
              hint="Coin balance and transfers"
              Icon={Coins}
              hue="money"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </SettingsRow>
          </Link>
          <p className="px-4 pb-3 pl-[4.5rem] text-[12px] text-ink-tertiary">{user?.email}</p>
        </SettingsSection>

        <SettingsSection
          id="privacy"
          title="Privacy"
          description="Choose what other people can see about you."
        >
          <div className="overflow-hidden rounded-[24px]">
            {values === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              TOGGLES.map(({ key, label, hint, Icon, hue }, i) => (
                <div key={key}>
                  {i > 0 && <div className="h-px bg-border" />}
                  <label className="flex min-h-16 items-center gap-3 px-4 py-3">
                    <SettingsIcon Icon={Icon} hue={hue} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-foreground">{label}</span>
                      <span className="block text-[12px] text-ink-tertiary">{hint}</span>
                    </span>
                    <Switch
                      checked={values[key]}
                      disabled={busy === key}
                      onCheckedChange={(next) => void toggle(key, next)}
                      aria-label={label}
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          id="appearance"
          title="Chats"
          description="Aurora appearance follows your device's light or dark setting."
        >
          <SettingsRow
            label="Message appearance"
            hint="Bubbles, media previews, and reply behavior"
            Icon={MessageCircle}
            hue="social"
          />
          <div className="h-px bg-border" />
          <SettingsRow
            label="Archived chats"
            hint="Your archived conversations will appear here"
            Icon={Archive}
            hue="system"
          />
        </SettingsSection>

        <SettingsSection
          id="devices"
          title="Notifications"
          description="Register this device for Firebase push messages."
        >
          <SettingsRow
            label="This device"
            Icon={Smartphone}
            hue="system"
            hint={
              pushError ??
              (pushState === "registered"
                ? "Device token registered. App event delivery is not configured yet."
                : "Permission and Firebase setup are required.")
            }
          >
            <Button
              variant={pushState === "registered" ? "secondary" : "default"}
              size="sm"
              disabled={
                pushBusy ||
                pushState === "loading" ||
                pushState === "unsupported" ||
                (pushState !== "registered" && getMissingFirebaseConfiguration().length > 0)
              }
              onClick={() => void togglePush()}
            >
              {pushBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pushState === "registered" ? "Remove device" : "Register device"}
            </Button>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="Storage & Data"
          description="Review media and data behavior for this device."
        >
          <SettingsRow
            label="Media downloads"
            hint="Attachments open from secure storage links"
            Icon={Image}
            hue="system"
          />
          <div className="h-px bg-border" />
          <SettingsRow
            label="Data usage"
            hint="Large media is limited to 25 MB per upload"
            Icon={Gauge}
            hue="system"
          />
        </SettingsSection>

        <SettingsSection
          title="Accessibility"
          description="Make Ripple easier to use with your device preferences."
        >
          <SettingsRow
            label="Motion"
            hint="Follows your browser's reduced-motion preference"
            Icon={Accessibility}
            hue="system"
          />
          <div className="h-px bg-border" />
          <SettingsRow
            label="Text size"
            hint="Uses your browser and operating-system text settings"
            Icon={Type}
            hue="system"
          />
        </SettingsSection>

        <SettingsSection
          id="support"
          title="Help"
          description="Find support and information about Ripple."
        >
          <SettingsRow
            label="Help center"
            hint="Troubleshooting and account guidance"
            Icon={CircleHelp}
            hue="system"
          />
          <div className="h-px bg-border" />
          <SettingsRow
            label="About Ripple"
            hint="Private messaging, status, and calling"
            Icon={Info}
            hue="system"
          />
        </SettingsSection>

        <button
          onClick={async () => {
            await signOut();
            await navigate({ to: "/auth" });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-card py-3 text-[17px] font-medium text-destructive"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
        <p className="pb-1 text-center text-[11px] text-ink-tertiary">BIGAD · Version 1.0.0</p>
      </div>

      <BottomNav />
    </main>
  );
}
