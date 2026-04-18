CREATE POLICY "Authenticated users can update demurrage payments"
  ON public.demurrage_payments
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);