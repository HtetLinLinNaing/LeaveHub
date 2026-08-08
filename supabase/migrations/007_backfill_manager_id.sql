-- Backfill manager_id for existing employees that have NULL.
-- Single-tenant org has one manager (seed: Bob, id b0000000-...-0002).
-- New creates are auto-assigned by the createEmployee action; this
-- migration covers rows created before that fix shipped.

UPDATE employees
SET manager_id = 'b0000000-0000-0000-0000-000000000002'
WHERE manager_id IS NULL
  AND id <> 'b0000000-0000-0000-0000-000000000002';
