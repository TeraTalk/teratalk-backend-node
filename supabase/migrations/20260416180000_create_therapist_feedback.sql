-- Create Therapist Feedback Table
CREATE TABLE IF NOT EXISTS public.therapist_feedback (
  id uuid default gen_random_uuid() primary key,
  booking_id uuid references public.therapist_bookings(id) on delete cascade not null,
  therapist_id uuid references auth.users(id) on delete cascade not null,
  guardian_id uuid references auth.users(id) on delete cascade not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable RLS
ALTER TABLE public.therapist_feedback ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own feeddback thread"
  ON public.therapist_feedback FOR SELECT
  USING (auth.uid() = therapist_id OR auth.uid() = guardian_id);

CREATE POLICY "Therapists can insert feedback"
  ON public.therapist_feedback FOR INSERT
  WITH CHECK (auth.uid() = therapist_id);

CREATE POLICY "Anyone in thread can update to mark read"
  ON public.therapist_feedback FOR UPDATE
  USING (auth.uid() = therapist_id OR auth.uid() = guardian_id);
