-- Create therapist_profiles table
CREATE TABLE IF NOT EXISTS public.therapist_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  full_name text,
  clinic_name text,
  specialty text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable RLS
ALTER TABLE public.therapist_profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for user access
CREATE POLICY "Users can view their own therapist profile"
  ON public.therapist_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own therapist profile"
  ON public.therapist_profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own therapist profile"
  ON public.therapist_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
