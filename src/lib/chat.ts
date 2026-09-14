import { supabase } from "@/integrations/supabase/client";

export type ProfileLite = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status_text: string | null;
  last_seen: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  reply_to: string | null;
  effect: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type ConversationSummary = {
  id: string;
  is_group: boolean;
  name: string | null;
  last_message_at: string;
  members: ProfileLite[];
  others: ProfileLite[];
  lastMessage: MessageRow | null;
  unread: number;
  myLastReadAt: string;
};

export function conversationTitle(c: {
  is_group: boolean;
  name: string | null;
  others: ProfileLite[];
}) {
  if (c.name) return c.name;
  if (c.others.length === 0) return "You";
  if (!c.is_group) return c.others[0]!.display_name;
  return c.others.map((o) => o.display_name.split(" ")[0]).join(", ");
}

export function previewText(m: MessageRow | null) {
  if (!m) return "No messages yet";
  if (m.deleted_at) return "Message deleted";
  if (m.body) return m.body;
  if (m.attachment_type?.startsWith("image/")) return "📷 Photo";
  if (m.attachment_url) return "📎 Attachment";
  return "";
}

export function formatListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86400000)
    return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
}

export function formatDivider(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export async function loadConversations(userId: string): Promise<ConversationSummary[]> {
  const { data: myRows } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);

  const ids = (myRows ?? []).map((r) => r.conversation_id);
  if (ids.length === 0) return [];

  const [{ data: convs }, { data: members }, { data: msgs }] = await Promise.all([
    supabase.from("conversations").select("id, is_group, name, last_message_at").in("id", ids),
    supabase.from("conversation_members").select("conversation_id, user_id").in("conversation_id", ids),
    supabase
      .from("messages")
      .select("*")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  const profileIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, status_text, last_seen")
    .in("id", profileIds.length ? profileIds : [userId]);

  const profileMap = new Map<string, ProfileLite>();
  (profiles ?? []).forEach((p) => profileMap.set(p.id, p as ProfileLite));

  const readMap = new Map<string, string>();
  (myRows ?? []).forEach((r) => readMap.set(r.conversation_id, r.last_read_at));

  return (convs ?? [])
    .map((c) => {
      const memberIds = (members ?? [])
        .filter((m) => m.conversation_id === c.id)
        .map((m) => m.user_id);
      const mem = memberIds.map((id) => profileMap.get(id)).filter(Boolean) as ProfileLite[];
      const convMsgs = ((msgs ?? []) as MessageRow[]).filter((m) => m.conversation_id === c.id);
      const lastReadAt = readMap.get(c.id) ?? "1970-01-01T00:00:00Z";
      return {
        id: c.id,
        is_group: c.is_group,
        name: c.name,
        last_message_at: c.last_message_at,
        members: mem,
        others: mem.filter((m) => m.id !== userId),
        lastMessage: convMsgs[0] ?? null,
        unread: convMsgs.filter(
          (m) => m.sender_id !== userId && new Date(m.created_at) > new Date(lastReadAt),
        ).length,
        myLastReadAt: lastReadAt,
      };
    })
    .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at));
}

export async function findOrCreateDirect(userId: string, otherId: string): Promise<string> {
  const { data: mine } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  const ids = (mine ?? []).map((m) => m.conversation_id);
  if (ids.length) {
    const { data: rows } = await supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", ids);
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, is_group")
      .in("id", ids)
      .eq("is_group", false);
    for (const c of convs ?? []) {
      const memberIds = (rows ?? []).filter((r) => r.conversation_id === c.id).map((r) => r.user_id);
      if (memberIds.length === 2 && memberIds.includes(otherId)) return c.id;
    }
  }
  return createConversation(userId, [otherId], false, null);
}

export async function createConversation(
  userId: string,
  otherIds: string[],
  isGroup: boolean,
  name: string | null,
): Promise<string> {
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ is_group: isGroup, name, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  const rows = [userId, ...otherIds].map((id) => ({ conversation_id: conv.id, user_id: id }));
  const { error: mErr } = await supabase.from("conversation_members").insert(rows);
  if (mErr) throw mErr;
  return conv.id;
}
