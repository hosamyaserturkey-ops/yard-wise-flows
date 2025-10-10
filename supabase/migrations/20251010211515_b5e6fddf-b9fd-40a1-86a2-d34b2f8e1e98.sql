-- Fix: Restrict profiles table access to authenticated users only
-- This prevents public access to email addresses and user information

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view all profiles"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);