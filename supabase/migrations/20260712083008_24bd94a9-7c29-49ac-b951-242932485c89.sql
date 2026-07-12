
CREATE TYPE public.activity_action AS ENUM ('gate_in', 'gate_out', 'reserve', 'unreserve', 'demurrage_collected');
CREATE TYPE public.work_shift AS ENUM ('day', 'night');

CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE,
  action public.activity_action NOT NULL,
  container_id uuid,
  container_number text,
  shift public.work_shift NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX activity_log_yard_time_idx ON public.activity_log (yard_id, occurred_at DESC);
CREATE INDEX activity_log_user_time_idx ON public.activity_log (user_id, occurred_at DESC);
CREATE INDEX activity_log_container_idx ON public.activity_log (container_number);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select_yard"
ON public.activity_log FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR yard_id = public.current_yard_id()
);

CREATE POLICY "activity_log_insert_own"
ON public.activity_log FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.is_super_admin(auth.uid())
    OR yard_id = public.current_yard_id()
  )
);

ALTER TABLE public.containers
  ADD COLUMN yard_block text,
  ADD COLUMN yard_row text;
