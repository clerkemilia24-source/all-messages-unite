CREATE OR REPLACE FUNCTION public.create_chat(_other_ids uuid[], _is_group boolean, _name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid; caller uuid := auth.uid();
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF cardinality(_other_ids) IS NULL OR cardinality(_other_ids) < 1 OR cardinality(_other_ids) > 100 OR caller = ANY(_other_ids) THEN RAISE EXCEPTION 'Invalid participants'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(_other_ids) x WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x)) THEN RAISE EXCEPTION 'Participant not found'; END IF;
 INSERT INTO public.conversations(is_group, name, created_by) VALUES (_is_group, nullif(trim(_name), ''), caller) RETURNING id INTO cid;
 INSERT INTO public.conversation_members(conversation_id, user_id) SELECT cid, x FROM (SELECT caller AS x UNION SELECT unnest(_other_ids)) u;
 RETURN cid;
END; $$;
REVOKE ALL ON FUNCTION public.create_chat(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chat(uuid[], boolean, text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.conversation_members, public.messages, public.profiles, public.reactions, public.typing_status TO authenticated;
GRANT ALL ON public.conversations, public.conversation_members, public.messages, public.profiles, public.reactions, public.typing_status TO service_role;