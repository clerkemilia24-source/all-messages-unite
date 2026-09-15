CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.bump_conversation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.is_member(uuid, uuid) SET SCHEMA private;
CREATE OR REPLACE FUNCTION private.is_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT _user_id = auth.uid() AND EXISTS (
 SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = _conversation_id AND m.user_id = _user_id
 );
$$;
REVOKE ALL ON FUNCTION private.is_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_member(uuid, uuid) TO authenticated, service_role;
CREATE FUNCTION public.is_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.is_member(_conversation_id, _user_id);
$$;
REVOKE ALL ON FUNCTION public.is_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member(uuid, uuid) TO authenticated, service_role;

ALTER FUNCTION public.create_chat(uuid[], boolean, text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.create_chat(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_chat(uuid[], boolean, text) TO authenticated, service_role;
CREATE FUNCTION public.create_chat(_other_ids uuid[], _is_group boolean, _name text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.create_chat(_other_ids, _is_group, _name);
$$;
REVOKE ALL ON FUNCTION public.create_chat(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chat(uuid[], boolean, text) TO authenticated, service_role;

ALTER POLICY "auth read attachments" ON storage.objects TO authenticated USING (
 bucket_id = 'attachments' AND EXISTS (
 SELECT 1 FROM public.messages m
 WHERE m.attachment_url = storage.objects.name
 AND m.deleted_at IS NULL
 AND private.is_member(m.conversation_id, auth.uid())
 )
);
ALTER POLICY "auth read avatars" ON storage.objects TO authenticated USING (
 bucket_id = 'avatars' AND (
 owner = auth.uid() OR EXISTS (
 SELECT 1 FROM public.profiles p
 JOIN public.conversation_members cm ON cm.user_id = p.id
 WHERE p.avatar_url = storage.objects.name
 AND p.id::text = split_part(storage.objects.name, '/', 1)
 AND private.is_member(cm.conversation_id, auth.uid())
 )
 )
);