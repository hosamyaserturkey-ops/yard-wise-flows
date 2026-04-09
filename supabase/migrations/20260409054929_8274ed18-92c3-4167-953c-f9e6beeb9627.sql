
-- Add new columns to demurrage_payments
ALTER TABLE public.demurrage_payments 
  ADD COLUMN IF NOT EXISTS service_fee numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS yard_share numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS shipping_line_share numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS transferred boolean NOT NULL DEFAULT false;

-- Create shipping_line_transfers table
CREATE TABLE public.shipping_line_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_line text NOT NULL,
  amount_transferred numeric NOT NULL,
  transferred_at timestamp with time zone NOT NULL DEFAULT now(),
  transferred_by uuid NOT NULL,
  receipt_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_line_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view transfers"
  ON public.shipping_line_transfers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert transfers"
  ON public.shipping_line_transfers FOR INSERT
  WITH CHECK (auth.uid() = transferred_by);

-- Create storage bucket for transfer receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('transfer-receipts', 'transfer-receipts', true);

CREATE POLICY "Authenticated users can upload receipts"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'transfer-receipts' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view receipts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'transfer-receipts');
