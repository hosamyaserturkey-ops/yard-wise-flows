DROP INDEX IF EXISTS public.container_port_data_container_number_idx;
CREATE UNIQUE INDEX IF NOT EXISTS container_port_data_container_yard_idx
  ON public.container_port_data (container_number, yard_id);