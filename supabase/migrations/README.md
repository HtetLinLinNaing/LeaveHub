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

## Status (this branch)

Service-role client shipped in `lib/supabase/admin.ts`. All server-side reads
and writes use it. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (see
`.env.local.example`).

## Applying 004_strict_rls.sql (closes the public-URL hole)

1. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` and your hosting env.
2. Run `004_strict_rls.sql` in the Supabase SQL editor, or:
   ```sh
   supabase db push  # if linked
   ```
3. Verify: anon-key queries now return 0 rows. The app still works because
   `lib/supabase/admin.ts` bypasses RLS, with role checks in `lib/actions.ts`
   and page-level filters as the application-level gate.

## What 004 does not address (out of scope)

- No `auth.users` insertion flow — relies on OAuth provider.
- No audit log table.
- No rate limiting (handled by Supabase gateway, mostly).

## What 004 does not address (out of scope)

- No `auth.users` insertion flow — relies on OAuth provider.
- No audit log table.
- No rate limiting (handled by Supabase gateway, mostly).
