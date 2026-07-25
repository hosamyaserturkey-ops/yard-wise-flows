-- Port data now records the container size, so demurrage is computed by the
-- shipping line's size-aware tiered formula (DEMURRAGE_RULES: rate20 vs rate40)
-- instead of a manual flat daily rate. The old daily_demurrage / free_days
-- columns stay (nullable) for back-compat with historical rows and the (unused)
-- container_demurrage view; the app no longer writes a manual daily rate.
ALTER TABLE public.container_port_data
  ADD COLUMN IF NOT EXISTS container_type text;
