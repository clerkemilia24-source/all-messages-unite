alter table public.status_replies
  add constraint status_replies_body_length
  check (char_length(body) between 1 and 1000) not valid;