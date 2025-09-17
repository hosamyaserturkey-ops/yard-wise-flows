-- Create bookings table
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  total_containers INTEGER NOT NULL,
  gated_out_containers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view all bookings" 
ON public.bookings 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create bookings" 
ON public.bookings 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update bookings" 
ON public.bookings 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

-- Add trigger for timestamps
CREATE TRIGGER update_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();