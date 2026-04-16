-- Drop the highly restrictive policy if it exists so we can replace it cleanly
DO $$ BEGIN
  DROP POLICY "Users can view their own therapist profile" ON public.therapist_profiles;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Add generalized READ access for authenticated users 
-- (You want Guardians to be able to see therapist profiles, 
-- but only therapists can update/insert their own profile)
DO $$ BEGIN
  CREATE POLICY "Anyone can view therapist profiles"
    ON public.therapist_profiles
    FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
