-- Add inspector role to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'inspector';

-- Inspector checks table
CREATE TABLE IF NOT EXISTS public.inspector_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number text NOT NULL,
  grade text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  photo_urls jsonb DEFAULT '[]'::jsonb,
  inspector_id uuid NOT NULL REFERENCES auth.users(id),
  yard_id uuid NOT NULL REFERENCES public.yards(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.inspector_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspector_checks_insert" ON public.inspector_checks
  FOR INSERT TO authenticated WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "inspector_checks_select" ON public.inspector_checks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "inspector_checks_update" ON public.inspector_checks
  FOR UPDATE TO authenticated USING (inspector_id = auth.uid());

-- Storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-photos',
  'inspection-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "inspection_photos_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inspection-photos');

CREATE POLICY "inspection_photos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'inspection-photos');
