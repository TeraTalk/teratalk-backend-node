-- Rich SODA analyzer fields (articulation_errors, soda_errors taxonomy, tongue position, etc.).

alter table public.user_speech_attempts
  add column if not exists soda_analysis jsonb;

comment on column public.user_speech_attempts.soda_analysis is
  'SODA structured diagnostics: articulation_errors, soda_errors, tongue_position_analysis, phoneme/text severities; null for phonological-only attempts.';
