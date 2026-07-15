# Remove container added today

One container was gated in today:

- **TFLU4976458** — visit `585483be…` gated in 2026-07-15 09:45 UTC, status `in-yard`.

## Actions

Run a single data change (via the insert/data tool):

1. `DELETE FROM container_visits WHERE id = '585483be-2ec9-47ca-b8a4-eb8934d55a8e'`
   — also removes any `inspector_checks`, `demurrage_payments`, `activity_log`, `edi_transmissions` rows that FK to this visit (cascade, per the refactor).
2. `DELETE FROM containers WHERE id = 'bc7058bb-2a0f-4ff6-819a-deb32837cb92'`
   — the master row for TFLU4976458, since it has no other visits.

No schema or code changes. No migration needed.

## Confirm

Is TFLU4976458 the one you want removed? Approve to run the deletes.
