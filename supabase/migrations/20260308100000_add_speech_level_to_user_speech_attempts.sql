-- Scope speech attempt history by level so pass count and window reset on level change.
-- Only attempts at the same level count toward promotion/demotion for that level.
alter table public.user_speech_attempts
  add column if not exists speech_level text not null default 'beginner';

create index if not exists idx_user_speech_attempts_user_level_time
  on public.user_speech_attempts (user_id, speech_level, created_at desc);

comment on column public.user_speech_attempts.speech_level is
  'Speech level at the time of this attempt; history is scoped by this so the window resets on level change.';
