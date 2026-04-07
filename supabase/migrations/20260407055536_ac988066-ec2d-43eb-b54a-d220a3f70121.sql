
CREATE TABLE public.demurrage_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number text NOT NULL,
  shipping_line text NOT NULL,
  chargeable_days integer NOT NULL,
  demurrage_amount numeric NOT NULL,
  handling_fee numeric NOT NULL DEFAULT 7,
  total_collected numeric NOT NULL,
  collected_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.demurrage_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert demurrage payments"
  ON public.demurrage_payments FOR INSERT
  TO public
  WITH CHECK (auth.uid() = collected_by);

CREATE POLICY "Authenticated users can view demurrage payments"
  ON public.demurrage_payments FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);
