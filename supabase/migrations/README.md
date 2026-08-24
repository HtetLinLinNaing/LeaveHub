# LeaveHub database migrations

Apply migrations in filename order. Use an approved local/disposable Supabase
project for development and migration rehearsal; never point a rehearsal or demo
bootstrap at production.

| Migration | Purpose |
| --- | --- |
| `001_initial_schema.sql` | Initial schema and prototype policies |
| `002_seed_data.sql` | Demo data |
| `003_add_auth_fk.sql` | Initial `NOT VALID` `public.users.id` to `auth.users.id` identity constraint |
| `004_strict_rls.sql` | Remove prototype anonymous policies and add role policies |
| `005_fix_rls_recursion.sql` | Add role helper functions that avoid recursive RLS |
| `006_fix_employees_recursion.sql` | Add employee helper functions that avoid recursive RLS |
| `007_compassionate_grants.sql` | Add compassionate leave grants |
| `008_mixed_durations_emergency_mc.sql` | Add per-day durations and request metadata |
| `009_supabase_password_auth.sql` | Add the durable Supabase Auth identity link and close remaining anonymous policies |

Server-side privileged access is centralized in `lib/dal/admin-client.ts`. The
service-role key must remain server-only and must never be exposed through a
`NEXT_PUBLIC_` variable, browser bundle, RSC payload, or response.

## Fresh local/disposable project

For a normal fresh setup, use an approved local/disposable project and apply
`001` through `009` in filename order. Migration `002` creates the demo rows
before their Supabase Auth identities exist. Migration `003` therefore adds the
legacy direct-ID foreign key as `NOT VALID`: PostgreSQL does not reject those
preexisting seed rows, while it still checks any new rows created before `009`.

Migration `009` backfills `auth_user_id = public.users.id` only where that same
ID already exists in `auth.users`, then drops the legacy direct-ID constraint.
On a fresh chain without Auth users, the seeded rows intentionally remain
`auth_user_id = NULL`. Set the one-time bootstrap variables, run
`npm run auth:bootstrap-demo`, review counts only, and immediately set
`ALLOW_DEMO_AUTH_BOOTSTRAP=false` or remove it. The bootstrap creates or finds
the Auth identities and links every demo public user. Confirm `unlinked_users`
is zero with the count query below before starting or deploying the app.

## Existing project upgrade and deployment order

Migration `009` is an expand-compatible migration: it adds
`public.users.auth_user_id`, backfills the existing identity correspondence,
updates authorization helpers, and removes the obsolete direct ID constraint.
The previous application can continue to read users by email through the
server-only client while the new application uses the identity link.

For an existing project, follow this order exactly:

1. Back up the database, including the `public` schema and Supabase Auth users,
   and verify that the backup is restorable.
2. Confirm migrations `003` through `008` are applied. Before applying `009`,
   verify every `public.users.id` has the corresponding `auth.users.id`; stop and
   reconcile any missing or conflicting identity instead of forcing the
   migration.
3. Apply `009_supabase_password_auth.sql` through the project's normal migration
   mechanism (`supabase db push` for an intentionally linked approved target, or
   the Supabase SQL editor). Review the migration result before continuing.
4. In a local administrative environment, set `DEMO_AUTH_PASSWORD` to the
   approved demo password and explicitly set the one-time safety flag
   `ALLOW_DEMO_AUTH_BOOTSTRAP=true`. Do not add either value to source control.
5. Run `npm run auth:bootstrap-demo`. Review the printed created, linked,
   password-updated, and unchanged counts; record counts only, never credentials.
6. Immediately set `ALLOW_DEMO_AUTH_BOOTSTRAP=false` or remove it after the one
   intentional bootstrap run.
7. Deploy the new application with the runtime Supabase URL, anonymous key, and
   server-only service-role key configured.
8. Smoke test employee, manager, and admin login, authorized navigation, session
   refresh, and Server Action logout. Confirm an employee cannot access direct
   `/approvals`, a manager sees only permitted direct-report requests, and an
   admin without an employee row can use admin pages.
9. Optionally remove obsolete `leavehub_mock_user` cookies from test browsers.
   Cleanup is not a security control: the new application ignores the cookie and
   it grants no access.

For an existing-project upgrade, this preflight correspondence query must return
zero rows before `009` is applied. That requirement ensures every existing
public user backfills during the migration:

```sql
select u.id, u.email
from public.users as u
left join auth.users as a on a.id = u.id
where a.id is null;
```

After migration and bootstrap, review links without exporting credentials:

```sql
select count(*) as public_users,
       count(auth_user_id) as linked_users,
       count(*) - count(auth_user_id) as unlinked_users
from public.users;
```

An approved target can be migrated with:

```sh
supabase db push
```

Never run that command until the linked project has been identified and approved.

## Rollback

During an incident, roll back application code first. Leave migration `009`, the
`auth_user_id` column, and all established identity links in place while the
incident is investigated. The migration is compatible with the previous
application, so dropping the identity link is neither necessary nor safe during
an application rollback.

Never restore anonymous RLS policies, including the old `auth.uid() IS NULL`
policies, and never reintroduce prototype public access. If identity links are
suspect, stop bootstrap activity, preserve evidence, compare the Auth and public
records, and repair links deliberately after the cause is understood.
