-- 1. Create a public 'avatars' storage bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public;

-- 2. Create generalized policies to allow public reads and authenticated uploads
-- READ POLICY for avatars bucket
DO $$ BEGIN
  CREATE POLICY "Public Access"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT POLICY for avatars bucket (Only auth users can upload)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can upload avatars"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE POLICY for avatars bucket 
DO $$ BEGIN
  CREATE POLICY "Authenticated users can update their avatars"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Add avatar URL to the therapist profile
ALTER TABLE public.therapist_profiles 
  ADD COLUMN IF NOT EXISTS avatar_url text;
