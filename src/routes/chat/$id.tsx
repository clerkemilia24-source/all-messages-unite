import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft, Paperclip, MoreHorizontal, X, Reply, Pencil, Trash2, File, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { type MessageRow, type ProfileLite, formatDivider } from '@/lib/chat';
import { uploadFile } from '@/lib/storage';
import { ChatAvatar, useRemoteUrl } from '@/components/RemoteImage';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/chat/$id')({
  validateSearch: (search: Record<string, unknown>): { message?: string } => ({ message: typeof search.message === 'string' ? search.message : undefined }),
  head: () => ({ meta: [
    { title: 'Conversation — Ripple' }, { name: 'description', content: 'Your private Ripple conversation.' },
    { property: 'og:title', content: 'Conversation — Ripple' }, { property: 'og:description', content: 'Messages, photos and tapbacks with your people.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
  ] }),
  component: Conversation,
});

type Reaction = { message_id: string; user_id: string; emoji: string };
type Member = { user_id: string; last_read_at: string };
function Attachment({ message }: { message: MessageRow }) {
  const url = useRemoteUrl('attachments', message.attachment_url);
  if (!url) return <span className="text-sm">Loading attachment…</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="block">
    {message.attachment_type?.startsWith('image/') ? <img src={url} alt="Shared photo" className="max-h-80 w-full rounded-xl object-contain" loading="lazy" /> : <span className="flex items-center gap-2 py-2"><File className="h-5 w-5" />Open attachment</span>}
  </a>;
}

function Conversation() {
  const { id } = Route.useParams();
  const { message: targetMessage } = Route.useSearch();
  const { user, loading } = useAuth();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState('Conversation');
  const [group, setGroup] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState<MessageRow | null>(null);
  const [editing, setEditing] = useState<MessageRow | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [conv, rows, membership] = await Promise.all([
      supabase.from('conversations').select('name, is_group').eq('id', id).single(),
      supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }),
      supabase.from('conversation_members').select('user_id, last_read_at').eq('conversation_id', id),
    ]);
    if (conv.error || rows.error || membership.error) { setError('This conversation could not be loaded.'); setReady(true); return; }
    const people = await supabase.from('profiles').select('*').in('id', membership.data.map(m => m.user_id));
    const ps = people.data ?? [];
    setProfiles(ps); setMembers(membership.data); setGroup(conv.data.is_group);
    setTitle(conv.data.name || ps.filter(p => p.id !== user.id).map(p => p.display_name).join(', ') || 'You');
    setMessages(rows.data); setError(''); setReady(true);
    if (rows.data.length) {
      const r = await supabase.from('reactions').select('message_id, user_id, emoji').in('message_id', rows.data.map(m => m.id));
      setReactions(r.data ?? []);
    } else setReactions([]);
    if (document.visibilityState === 'visible') {
      const latest = rows.data.at(-1)?.created_at;
      const mine = membership.data.find(m => m.user_id === user.id);
      if (latest && mine && latest > mine.last_read_at) await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', id).eq('user_id', user.id);
    }
  }, [id, user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const channel = supabase.channel(`chat-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${id}` }, () => void refresh()).subscribe();
    const poll = setInterval(() => {
      void supabase.from('typing_status').select('user_id').eq('conversation_id', id).neq('user_id', user.id).gt('updated_at', new Date(Date.now() - 4000).toISOString()).then(({ data }) => setTyping((data ?? []).map(t => t.user_id)));
    }, 2000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { void supabase.removeChannel(channel); clearInterval(poll); document.removeEventListener('visibilitychange', visible); void supabase.from('typing_status').delete().eq('conversation_id', id).eq('user_id', user.id); };
  }, [id, user, refresh]);
  useEffect(() => {
    if (targetMessage) document.getElementById(`message-${targetMessage}`)?.scrollIntoView({ behavior: 'instant', block: 'center' });
    else bottom.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length, typing.length, targetMessage]);

  async function send() {
    if (!user || busy || (!body.trim() && !file)) return;
    setBusy(true);
    try {
      if (editing) {
        const { error } = await supabase.from('messages').update({ body: body.trim(), edited_at: new Date().toISOString() }).eq('id', editing.id).eq('sender_id', user.id);
        if (error) throw error;
      } else {
        const path = file ? await uploadFile('attachments', user.id, file) : null;
        const { error } = await supabase.from('messages').insert({ conversation_id: id, sender_id: user.id, body: body.trim() || null, attachment_url: path, attachment_type: file?.type || null, reply_to: reply?.id ?? null });
        if (error) throw error;
      }
      setBody(''); setFile(null); setReply(null); setEditing(null);
      await supabase.from('typing_status').delete().eq('conversation_id', id).eq('user_id', user.id);
      await refresh();
    } catch { toast.error('Message could not be sent. Please try again.'); } finally { setBusy(false); }
  }
  async function react(messageId: string, emoji: string) {
    if (!user) return;
    const exists = reactions.some(r => r.message_id === messageId && r.user_id === user.id && r.emoji === emoji);
    const result = exists ? await supabase.from('reactions').delete().eq('message_id', messageId).eq('user_id', user.id) : await supabase.from('reactions').upsert({ message_id: messageId, user_id: user.id, emoji }, { onConflict: 'message_id,user_id' });
    if (result.error) toast.error('Could not update tapback.');
    setSelected(null); await refresh();
  }
  async function remove(m: MessageRow) {
    if (!user || !window.confirm('Delete this message for everyone?')) return;
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null, attachment_url: null, attachment_type: null }).eq('id', m.id).eq('sender_id', user.id);
    if (error) toast.error('Could not delete message.');
    setSelected(null); await refresh();
  }
  if (!loading && !user) return <main className="flex min-h-dvh items-center justify-center"><Button asChild><Link to="/auth">Sign in to view messages</Link></Button></main>;
  const other = profiles.find(p => p.id !== user?.id);
  const lastOutgoing = messages.filter(m => m.sender_id === user?.id).at(-1)?.id;
  return <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-background">
    <header className="relative flex shrink-0 items-center justify-center border-b border-border bg-chrome px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
      <Button asChild variant="ghost" size="icon" className="absolute left-2 text-primary"><Link to="/" aria-label="Back to messages"><ChevronLeft /></Link></Button>
      <div className="flex max-w-[75%] flex-col items-center gap-1"><ChatAvatar name={title} path={group ? null : other?.avatar_url} size={40} /><h1 className="w-full truncate text-sm font-semibold">{title}</h1></div>
    </header>
    <section aria-label="Messages" className="flex-1 overflow-y-auto px-4 py-5">
      {!ready ? <Loader2 className="mx-auto animate-spin text-muted-foreground" /> : error ? <div role="alert" className="text-center text-muted-foreground">{error}<Button variant="link" onClick={() => void refresh()}>Try again</Button></div> : messages.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No messages yet</p> : null}
      {messages.map((m, i) => {
        const own = m.sender_id === user?.id;
        const quoted = messages.find(x => x.id === m.reply_to);
        const rs = reactions.filter(r => r.message_id === m.id);
        const showDate = i === 0 || new Date(m.created_at).getTime() - new Date(messages[i - 1]?.created_at ?? 0).getTime() > 300000;
        return <div key={m.id} id={`message-${m.id}`} className={targetMessage === m.id ? 'rounded-lg ring-2 ring-primary' : undefined}>
          {showDate && <p className="my-5 text-center text-xs text-muted-foreground">{formatDivider(m.created_at)}</p>}
          <div className={`mb-2 flex flex-col ${own ? 'items-end' : 'items-start'}`}>
            {group && !own && <span className="mb-1 pl-3 text-xs text-muted-foreground">{profiles.find(p => p.id === m.sender_id)?.display_name}</span>}
            <div className={`relative max-w-[85%] rounded-[20px] px-3.5 py-2 ${own ? 'rounded-br-md bg-bubble-out text-bubble-out-foreground' : 'rounded-bl-md bg-bubble-in text-bubble-in-foreground'}`} onDoubleClick={() => !m.deleted_at && setSelected(m.id)}>
              {quoted && <p className="mb-2 border-l-2 border-current pl-2 text-xs opacity-75">{quoted.deleted_at ? 'Message deleted' : quoted.body || 'Attachment'}</p>}
              {m.deleted_at ? <p className="text-sm italic">Message deleted</p> : <>{m.attachment_url && <Attachment message={m} />}{m.body && <p className="whitespace-pre-wrap break-words text-[17px] leading-snug [overflow-wrap:anywhere]">{m.body}</p>}</>}
            </div>
            {!m.deleted_at && <div className="flex items-center gap-1">
              {rs.length > 0 && <span className="rounded-full bg-secondary px-2 text-sm" aria-label="Tapbacks">{Array.from(new Set(rs.map(r => r.emoji))).join(' ')} {rs.length > 1 ? rs.length : ''}</span>}
              <Button variant="ghost" size="icon" className="h-6 w-7 text-muted-foreground" aria-label={`Message actions ${i + 1}`} onClick={() => setSelected(selected === m.id ? null : m.id)}><MoreHorizontal /></Button>
              {m.edited_at && <span className="text-[10px] text-muted-foreground">Edited</span>}
            </div>}
            {selected === m.id && <div className="my-1 max-w-full rounded-lg border border-border bg-popover p-2 shadow-sm">
              <div className="flex flex-wrap gap-1">{['❤️', '👍', '👎', '😂', '‼️', '❓'].map(emoji => <Button key={emoji} variant="ghost" size="icon" aria-label={`React ${emoji}`} onClick={() => void react(m.id, emoji)}>{emoji}</Button>)}</div>
              <div className="mt-1 flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setReply(m); setEditing(null); setSelected(null); }}><Reply />Reply</Button>{own && <><Button variant="ghost" size="sm" disabled={!m.body} onClick={() => { setEditing(m); setBody(m.body ?? ''); setReply(null); setFile(null); setSelected(null); }}><Pencil />Edit</Button><Button variant="ghost" size="sm" onClick={() => void remove(m)}><Trash2 />Delete</Button></>}</div>
            </div>}
            {own && m.id === lastOutgoing && !m.deleted_at && <span className="text-[11px] text-muted-foreground">{members.some(x => x.user_id !== user?.id && new Date(x.last_read_at) >= new Date(m.created_at)) ? 'Read' : 'Sent'}</span>}
          </div>
        </div>;
      })}
      {typing.length > 0 && <div role="status" className="mt-3 w-fit rounded-full bg-bubble-in px-4 py-2 text-sm text-muted-foreground">{typing.map(t => profiles.find(p => p.id === t)?.display_name ?? 'Someone').join(', ')} is typing…</div>}
      <div ref={bottom} />
    </section>
    <footer className="shrink-0 border-t border-border bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {(reply || editing || file) && <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-1 text-sm"><span className="truncate">{editing ? `Editing: ${editing.body}` : reply ? `Replying: ${reply.body || 'Attachment'}` : file?.name}</span><Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={() => { if (editing) setBody(''); setEditing(null); setReply(null); setFile(null); }}><X /></Button></div>}
      <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input type="file" className="hidden" ref={input} onChange={e => { const f = e.target.files?.[0]; if (f && f.size > 25 * 1024 * 1024) toast.error('Choose a file smaller than 25 MB.'); else setFile(f ?? null); e.target.value = ''; }} />
        <Button type="button" variant="ghost" size="icon" aria-label="Attach photo or file" disabled={busy || !!editing || !ready || !!error} onClick={() => input.current?.click()}><Paperclip /></Button>
        <textarea aria-label="Message" placeholder="Message" rows={1} value={body} disabled={busy || !!error} className="max-h-32 min-h-10 min-w-0 flex-1 resize-y rounded-[20px] border border-input bg-background px-4 py-2 text-base outline-none focus:ring-1 focus:ring-ring" onChange={e => { setBody(e.target.value); if (user && Date.now() - lastTyping.current > 1500) { lastTyping.current = Date.now(); void supabase.from('typing_status').upsert({ conversation_id: id, user_id: user.id, updated_at: new Date().toISOString() }); } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <Button type="submit" size="icon" className="mb-0.5 shrink-0 rounded-full" aria-label={editing ? 'Save message' : 'Send message'} disabled={busy || !ready || !!error || (!body.trim() && !file)}>{busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}</Button>
      </form>
    </footer>
  </main>;
}
