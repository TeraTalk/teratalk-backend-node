-- 1. Modify existing therapist_profiles
ALTER TABLE public.therapist_profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS is_accepting_patients boolean default true;

-- 2. Create Therapist Packages Table
CREATE TABLE IF NOT EXISTS public.therapist_packages (
  id uuid default gen_random_uuid() primary key,
  therapist_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  duration_months int not null,
  price numeric not null,
  description text,
  therapy_goals jsonb default '[]'::jsonb,
  active boolean default true,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

ALTER TABLE public.therapist_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active packages"
  ON public.therapist_packages FOR SELECT
  USING (active = true OR auth.uid() = therapist_id);

CREATE POLICY "Therapists can insert their own packages"
  ON public.therapist_packages FOR INSERT
  WITH CHECK (auth.uid() = therapist_id);

CREATE POLICY "Therapists can update their own packages"
  ON public.therapist_packages FOR UPDATE
  USING (auth.uid() = therapist_id);

-- 3. Create Therapist Bookings Table
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'active', 'completed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.therapist_bookings (
  id uuid default gen_random_uuid() primary key,
  therapist_id uuid references auth.users(id) on delete cascade not null,
  guardian_id uuid references auth.users(id) on delete cascade not null,
  package_id uuid references public.therapist_packages(id) on delete set null,
  status booking_status default 'pending' not null,
  preferred_schedule jsonb,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

ALTER TABLE public.therapist_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Therapists and guardians can view their own bookings"
  ON public.therapist_bookings FOR SELECT
  USING (auth.uid() = therapist_id OR auth.uid() = guardian_id);

CREATE POLICY "Guardians can insert bookings"
  ON public.therapist_bookings FOR INSERT
  WITH CHECK (auth.uid() = guardian_id);

CREATE POLICY "Therapists can update bookings"
  ON public.therapist_bookings FOR UPDATE
  USING (auth.uid() = therapist_id);

-- 4. Enable Therapist Access to Patient Data
ALTER TABLE public.user_speech_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own speech attempts" 
    ON public.user_speech_attempts FOR SELECT 
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view their own profiles" 
    ON public.user_profiles FOR SELECT 
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Therapists can view active patient speech attempts"
    ON public.user_speech_attempts FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.therapist_bookings b
        WHERE b.therapist_id = auth.uid() 
        AND b.guardian_id = user_speech_attempts.user_id
        AND b.status = 'active'
        AND timezone('utc'::text, now()) BETWEEN b.start_date AND b.end_date
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Therapists can view active patient profiles"
    ON public.user_profiles FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.therapist_bookings b
        WHERE b.therapist_id = auth.uid() 
        AND b.guardian_id = user_profiles.user_id
        AND b.status = 'active'
        AND timezone('utc'::text, now()) BETWEEN b.start_date AND b.end_date
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
