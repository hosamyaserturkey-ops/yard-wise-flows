-- Create the enum first
CREATE TYPE container_status AS ENUM ('in-yard', 'out', 'reserved');

-- Add booking_id column first
ALTER TABLE public.containers 
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id);

-- Update the status column in steps
-- Step 1: Add new column with enum type
ALTER TABLE public.containers 
ADD COLUMN IF NOT EXISTS status_new container_status DEFAULT 'in-yard';

-- Step 2: Copy data from old status column to new one
UPDATE public.containers 
SET status_new = CASE 
  WHEN status = 'in-yard' THEN 'in-yard'::container_status
  WHEN status = 'out' THEN 'out'::container_status
  ELSE 'in-yard'::container_status
END;

-- Step 3: Drop old column and rename new one
ALTER TABLE public.containers DROP COLUMN status;
ALTER TABLE public.containers RENAME COLUMN status_new TO status;

-- Step 4: Set not null constraint
ALTER TABLE public.containers ALTER COLUMN status SET NOT NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_containers_booking_id ON public.containers(booking_id);
CREATE INDEX IF NOT EXISTS idx_containers_status ON public.containers(status);

-- Update existing containers with booking_number to link via booking_id where possible
UPDATE public.containers 
SET booking_id = (
  SELECT b.id 
  FROM public.bookings b 
  WHERE b.booking_number = containers.booking_number
)
WHERE booking_number IS NOT NULL AND booking_id IS NULL;