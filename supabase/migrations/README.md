# RLS audit — LeaveHub

Migration order:

1. `001_initial_schema.sql` — schema + dev policies (`auth.uid() IS NULL` → anon full access)
2. `002_seed_data.sql` — seed rows
3. `003_add_auth_fk.sql` — `users.id → auth.users.id` FK (requires OAuth)
4. `004_strict_rls.sql` — drops dev policies, applies real ones using `auth.uid() = id`

## Current state (dev)

- Only `001` is applied in dev. Anon key has full read/write to every table.
- This is intentional for the mock-auth prototype. The Supabase URL and anon key
  are public env vars, so anyone with the URL can read/write the whole DB.
- This is the most material unfixed risk in the codebase. Cookie forgery is
  fixed; this is the database-side equivalent.

## After OAuth lands (prod)

Apply `003` then `004` in order. After `004`:
- Anon key (`auth.uid() = NULL`) is denied everything.
- `auth.uid() = <user id>` is allowed own records + appropriate role scopes.

## Conflict with current server actions

`lib/actions.ts` uses `createClient()` which is anon. Once `004` applies, these
fail:

- `createEmployee` — denied by `HR can manage employees` (requires auth.uid to be hr/admin)
- `approveLeaveRequest` — same
- `createLeaveRequest` / `cancelLeaveRequest` — denied (own-record policies need auth.uid)
- `createHoliday` / `deleteHoliday` / `updateLeaveTypeDays` — denied

**Fix before applying 004:** add a service-role Supabase client
(`SUPABASE_SERVICE_ROLE_KEY`) and use it in `lib/actions.ts`. Then the server
action runs as a privileged role, not anon, and the role checks (`canApproveLeave`
etc.) remain the application-level gate.

## What 004 does not address (out of scope)

- No `auth.users` insertion flow — relies on OAuth provider.
- No audit log table.
- No rate limiting (handled by Supabase gateway, mostly).
