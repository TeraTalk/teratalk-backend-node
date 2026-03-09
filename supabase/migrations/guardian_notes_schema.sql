-- Guardian Journal Schema

CREATE TABLE public.guardian_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  note_text text NOT NULL,
  milestone_type text, -- e.g., 'Milestone', 'Observation', 'Challenge', null
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT guardian_notes_pkey PRIMARY KEY (id),
  CONSTRAINT guardian_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Note: You should run this script in your Supabase SQL Editor.
