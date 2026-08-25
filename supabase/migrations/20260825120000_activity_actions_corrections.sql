-- Two new activity actions for the correction workflows added alongside this
-- migration: cancelling a mistaken inspection, and renaming a container that
-- was gated in under a mistyped number.
--
-- These live in their own migration because a value added to an enum with
-- ALTER TYPE ... ADD VALUE cannot be USED in the same transaction that adds
-- it, and the following migrations reference both values.
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'inspection_cancelled';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'container_renamed';
