-- Only count kid attempts toward speech level progression (not guardian/adult turns in Ludo).
alter table public.user_speech_attempts
  add column if not exists is_kid_attempt boolean not null default true;

create index if not exists idx_user_speech_attempts_user_level_kid_time
  on public.user_speech_attempts (user_id, speech_level, created_at desc)
  where is_kid_attempt = true;

comment on column public.user_speech_attempts.is_kid_attempt is
  'True when the attempt was from the kid (e.g. kid turn in Ludo). Only kid attempts count toward level progression.';
