-- Whether the model judged the utterance as the wrong target word (SODA / phonological).

alter table public.user_speech_attempts
  add column if not exists wrong_word boolean;

comment on column public.user_speech_attempts.wrong_word is
  'True when the analyzer reports wrong_word; null when the field was not returned.';
