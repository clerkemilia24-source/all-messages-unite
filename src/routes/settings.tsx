import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ChatAvatar } from "@/components/RemoteImage";
import { BottomNav } from "@/components/BottomNav";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ripple" },
      {
        name: "description",
        content: "Control your privacy: read receipts, last seen, profile photo and status visibility.",
      },
      { property: "og:title", content: "Settings — Ripple" },
      { property: "og:description", content: "Privacy and account settings for your Ripple profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type PrivacyKey = "read_receipts" | "last_seen_visible" | "photo_visible" | "status_visible";

const TOGGLES: { key: PrivacyKey; label: string; hint: string }[] = [
  { key: "read_receipts", label: "Read receipts", hint: "Let others see when you've read their messages." },
  { key: "last_seen_visible", label: "Last seen & online", hint: "Show when you were last active." },
  { key: "photo_visible", label: "Profile photo", hint: "Show your photo to people you chat with." },
  { key: "status_visible", label: "Status updates", hint: "Let your chats see your status posts." },
];

function SettingsPage() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<PrivacyKey, boolean> | null>(null);
  const [busy, setBusy] = useState<PrivacyKey | null>(null);

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

  const toggle = async (key: PrivacyKey, next: boolean) => {
    if (!user || !values) return;
    const previous = values[key];
    setValues({ ...values, [key]: next });
    setBusy(key);
    const { error } = await supabase.from("profiles").update({ [key]: next }).eq("id", user.id);
    setBusy(null);
    if (error) {
      setValues({ ...values, [key]: previous });
      toast.error("That setting could not be saved");
      return;
    }
    await refreshProfile();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-chrome px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <h1 className="text-[2rem] font-bold tracking-tight text-foreground">Settings</h1>
      </header>

      <div className="flex-1 space-y-6 px-4 py-4">
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 transition active:scale-[0.99]"
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

        <section>
          <p className="px-2 pb-2 text-[13px] uppercase tracking-wide text-muted-foreground">Privacy</p>
          <div className="overflow-hidden rounded-xl bg-card">
            {values === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              TOGGLES.map(({ key, label, hint }, i) => (
                <div key={key}>
                  {i > 0 && <div className="h-px bg-border" />}
                  <label className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] text-foreground">{label}</span>
                      <span className="block text-[13px] text-muted-foreground">{hint}</span>
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
        </section>

        <section>
          <p className="px-2 pb-2 text-[13px] uppercase tracking-wide text-muted-foreground">Account</p>
          <div className="overflow-hidden rounded-xl bg-card">
            <Link to="/contacts" className="flex items-center px-4 py-3 text-[16px] text-foreground">
              <span className="flex-1">Contacts</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
            <div className="h-px bg-border" />
            <Link to="/calls" className="flex items-center px-4 py-3 text-[16px] text-foreground">
              <span className="flex-1">Call history</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
          </div>
          <p className="px-2 pt-2 text-[13px] text-muted-foreground">{user?.email}</p>
        </section>

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
      </div>

      <BottomNav />
    </main>
  );
}
