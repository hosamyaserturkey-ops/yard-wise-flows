TRUNCATE TABLE
  public.demurrage_payments,
  public.shipping_line_transfers,
  public.edi_transmissions,
  public.containers,
  public.container_port_data,
  public.bookings
RESTART IDENTITY;

INSERT INTO public.container_port_data
  (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, last_source) VALUES
  ('SLGU1234567','SLG','2026-03-15',7,25,'manual'),
  ('SLDU2345678','SLD','2026-03-20',7,25,'manual'),
  ('SFSU3456789','SFS','2026-04-01',7,30,'manual'),
  ('MDKU4567890','MDK','2026-04-05',7,20,'manual'),
  ('INXU5678901','INX','2026-04-08',7,35,'manual'),
  ('ICRU6789012','ICR','2026-04-10',7,28,'manual'),
  ('EMKU7890123','EMK','2026-04-12',7,22,'manual'),
  ('BLTU8901234','BLT','2026-04-14',7,25,'manual'),
  ('AXLU9012345','AXL','2026-04-15',7,30,'manual'),
  ('XSLU0123456','XSL','2026-04-17',7,25,'manual'),
  ('TRLU1122334','TRL','2026-04-18',7,25,'manual'),
  ('2XXU2233445','2',  '2026-04-19',7,25,'manual'),
  ('SEKU1157908','SLD','2026-03-10',7,30,'manual'),
  ('MSCU3344556','SLG','2026-04-19',7,25,'manual'),
  ('CMAU4455667','SFS','2026-04-02',7,30,'manual');