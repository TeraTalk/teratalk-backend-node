-- Rich phonological detector payload for dashboards (errors, phoneme lists, etc.).
-- Null for SODA-only attempts and legacy rows.

alter table public.user_speech_attempts
  add column if not exists phonological_analysis jsonb;

comment on column public.user_speech_attempts.phonological_analysis is
  'Phonological detector structured output: errors, phoneme arrays, wrong_word, severity_details, etc.';
