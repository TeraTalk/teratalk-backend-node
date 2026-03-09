-- Enrich user_speech_attempts with expected word, transcribed result, and context for reporting.
-- All new columns nullable for backward compatibility with existing rows and legacy callers.

alter table public.user_speech_attempts
  add column if not exists expected_word text,
  add column if not exists expected_sound text,
  add column if not exists transcribed_word text,
  add column if not exists error_type text,
  add column if not exists confidence numeric(4,3),
  add column if not exists game_type text,
  add column if not exists word_id text,
  add column if not exists attempt_number smallint,
  add column if not exists game_level smallint,
  add column if not exists analysis_model text;

comment on column public.user_speech_attempts.expected_word is
  'Word the child was asked to say (expected_text/word from request).';
comment on column public.user_speech_attempts.expected_sound is
  'Target sound for the word (e.g. SH, K, S) for by-sound analytics.';
comment on column public.user_speech_attempts.transcribed_word is
  'What the model heard (sodaResponse.predicted).';
comment on column public.user_speech_attempts.error_type is
  'SODA/Phonological error label for therapy and reporting.';
comment on column public.user_speech_attempts.confidence is
  'Model confidence 0-1 for filtering low-confidence attempts.';
comment on column public.user_speech_attempts.game_type is
  'Game context (e.g. pizza_toppings, candy_land).';
comment on column public.user_speech_attempts.word_id is
  'Optional link to word list / content item.';
comment on column public.user_speech_attempts.attempt_number is
  'Attempt index in the round (1-5).';
comment on column public.user_speech_attempts.game_level is
  'Difficulty level at attempt time (2-5).';
comment on column public.user_speech_attempts.analysis_model is
  'Analysis model used: soda or phonological.';
