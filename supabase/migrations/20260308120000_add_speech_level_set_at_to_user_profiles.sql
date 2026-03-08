-- When speech_level changes (promotion, demotion, or profile edit), only attempts
-- after this timestamp count toward the next promotion/demotion. This resets
-- the "tries" window so old attempts at the same level don't count.
alter table public.user_profiles
  add column if not exists speech_level_set_at timestamptz;

comment on column public.user_profiles.speech_level_set_at is
  'When the user was last set to the current speech_level; only attempts after this time count toward level change.';

-- Backfill: existing profiles get a fresh window from now so old attempts don't count
update public.user_profiles
set speech_level_set_at = timezone('utc', now())
where speech_level_set_at is null;
