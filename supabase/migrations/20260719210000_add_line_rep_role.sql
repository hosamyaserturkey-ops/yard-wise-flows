-- Shipping-line representative role: a login scoped to a single shipping line.
-- (Enum additions must be committed before the value can be used, so the
-- scoping migration that references 'line_rep' lives in the next file.)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'line_rep';
