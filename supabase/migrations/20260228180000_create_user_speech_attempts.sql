create table if not exists public.user_speech_attempts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_pass boolean not null,
  severity numeric(4,3),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_speech_attempts_user_time
  on public.user_speech_attempts (user_id, created_at desc);
