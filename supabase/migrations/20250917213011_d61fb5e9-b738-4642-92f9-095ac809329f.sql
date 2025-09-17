-- Add reserved status to containers and improve booking relationship
ALTER TYPE container_status ADD VALUE 'reserved';

-- Add booking_id foreign key to containers table for better relationship management
ALTER TABLE public.containers 
ADD COLUMN booking_id UUID REFERENCES public.bookings(id);

-- Create index for better performance on booking queries
CREATE INDEX idx_containers_booking_id ON public.containers(booking_id);

-- Create index for status queries
CREATE INDEX idx_containers_status ON public.containers(status);

-- Update existing containers with booking_number to link via booking_id where possible
UPDATE public.containers 
SET booking_id = (
  SELECT b.id 
  FROM public.bookings b 
  WHERE b.booking_number = containers.booking_number
)
WHERE booking_number IS NOT NULL;