-- A 40ft container is a high cube (40HC) unless the line marks it 40GP. The
-- port-list import read a bare "40" (WOM's sheet has only a Size column) as
-- 40GP, so the imported lists, and the containers gated in from them, were
-- labelled standard boxes. The import now reads a plain 40 as 40HC; this brings
-- the stored records in line.
--
-- Demurrage is billed by length only (rate20 / rate40), so no charge changes.
--
-- Records changed when this was applied on 08/10/2026:
--   container_port_data: 58 WOM rows, imported 03/10 – 07/10/2026
--   containers (all in yard, none gated out):
--     WOM: CICU1700279, CICU2439025, CICU6713031, CICU9518620, HPCU4173550,
--          KKFU7706532, PONU7572430, SNBU8160621, TEMU6089813, WSCU7275557
--     EEL: YMLU8665480

UPDATE public.container_port_data
   SET container_type = '40HC', updated_at = now()
 WHERE container_type = '40GP';

UPDATE public.containers
   SET container_type = '40HC'
 WHERE container_type = '40GP';
