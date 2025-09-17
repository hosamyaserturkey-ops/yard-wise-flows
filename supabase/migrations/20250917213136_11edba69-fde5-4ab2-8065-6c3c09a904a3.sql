-- Check if we need to create the enum first, then add reserved status
DO $$
BEGIN
    -- Check if enum exists, if not create it
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'container_status') THEN
        CREATE TYPE container_status AS ENUM ('in-yard', 'out');
    END IF;
    
    -- Add reserved status if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'container_status') 
        AND enumlabel = 'reserved'
    ) THEN
        ALTER TYPE container_status ADD VALUE 'reserved';
    END IF;
END $$;

-- Update containers table to use the enum if not already
DO $$
BEGIN
    -- Check if status column exists and update it to use enum
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'containers' 
        AND column_name = 'status' 
        AND data_type = 'text'
    ) THEN
        -- First set a default for existing data
        UPDATE containers SET status = 'in-yard' WHERE status NOT IN ('in-yard', 'out', 'reserved');
        
        -- Alter column to use enum
        ALTER TABLE containers ALTER COLUMN status TYPE container_status USING status::container_status;
    END IF;
END $$;

-- Add booking_id foreign key to containers table for better relationship management
ALTER TABLE public.containers 
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id);

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