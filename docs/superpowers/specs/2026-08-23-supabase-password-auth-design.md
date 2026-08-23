# Supabase Password Authentication Design

**Date:** 2026-08-23

**Status:** Approved for implementation planning

## Objective

Replace LeaveHub's browser-written mock email cookie with Supabase email/password authentication for fake `@company.com` demo users. Establish a request-scoped server authentication boundary, preserve all existing application identifiers and authorization rules, isolate the service-role database capability, and close anonymous-access policies introduced after the strict-RLS migrations.

Google OAuth is intentionally deferred until real company Google accounts exist. The authorization architecture must allow that provider to be added later without changing LeaveHub roles or employee relationships.

## Confirmed Starting State

- Next.js 16.3.0 App Router with React 19.2.8.
- `@supabase/supabase-js` 2.112.x is installed.
- Migrations `003_add_auth_fk.sql`, `004_strict_rls.sql`, `005_fix_rls_recursion.sql`, and `006_fix_employees_recursion.sql` are applied.
- Existing rows currently use `auth.users.id = public.users.id`.
- Application pages and Server Actions use a server-only service-role client and enforce authorization in application code.
- `leave_grants` and `leave_request_days` were created after the strict-RLS migration and still have anonymous development policies.
- Phase 1 authorization and validation hardening is merged in PR #32.

## Chosen Approach

Use Supabase SSR authentication for identity and cookie lifecycle while retaining the service-role database client behind a request-scoped authenticated capability.

This staged approach is preferred over immediately converting every database query to a caller-scoped RLS client. It replaces the insecure session boundary now, preserves the Phase 1 authorization checks, closes anonymous database access, and avoids combining authentication migration with the query, transaction, and caching refactors assigned to later phases.

The alternatives were rejected as follows:

1. A full RLS-first conversion would require policies for every read and mutation across leave requests, grants, per-day rows, balances, and storage. It is valuable defense in depth but is too broad for this phase.
2. Keeping `public.users.id = auth.users.id` would force employee creation to provision Auth first and coordinate non-transactional writes across Auth and PostgreSQL.
3. Disabling employee creation after enabling Auth would remove an existing product capability.

## Identity Model

`public.users.id` remains LeaveHub's stable application identifier. A new nullable identity link stores the Supabase Auth identifier:

```text
auth.users.id
  -> public.users.auth_user_id (unique, nullable foreign key)

public.users.id
  -> employees.user_id
  -> all existing employee, leave, grant, and approval relationships
```

The migration will:

1. Add `public.users.auth_user_id uuid UNIQUE`.
2. Backfill existing rows with `auth_user_id = id`.
3. Add `users_auth_user_id_fkey` referencing `auth.users(id)` with `ON DELETE SET NULL`.
4. Drop the old `users_id_fkey` from `public.users.id` to `auth.users.id`.
5. Preserve `public.users.id` and all downstream foreign keys unchanged.

New employees may be pre-provisioned with `auth_user_id = NULL`. The explicit demo bootstrap command later creates or locates the Auth identity and links it.

Identity links are never silently reassigned. A conflicting email, Auth ID, or existing link causes the bootstrap to fail with a non-secret diagnostic.

## Request Architecture

```text
Browser
  |
  +-- Login form
  |     -> login Server Action
  |     -> cookie-backed Supabase SSR client
  |     -> signInWithPassword(email, password)
  |     -> require linked active LeaveHub actor
  |     -> redirect("/")
  |
  +-- Authenticated request
        -> Next.js proxy refreshes/verifies Supabase token
        -> request-scoped requireActor()
             -> verified Supabase claims
             -> public.users.auth_user_id lookup
             -> employee/status lookup
             -> immutable Actor
        -> authenticated request context
             -> Actor
             -> server-only service-role database client
        -> Server Component or Server Action
        -> PostgreSQL / Supabase Storage
```

The proxy performs token refresh and coarse unauthenticated redirects only. It is not an authorization boundary. Every protected Server Component and every Server Action independently obtains a verified actor.

The design follows Supabase's current SSR guidance:

- Use `@supabase/ssr` for cookie-backed Next.js sessions.
- Use verified claims or a fresh Auth lookup for authorization, not the unverified user object returned by `getSession()`.
- Refresh tokens in the Next.js proxy because Server Components cannot persist refreshed cookies.

References:

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/choosing-a-server-package
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword

## Module Boundaries

### `lib/supabase/server.ts`

Creates a cookie-backed Supabase SSR client using the existing public URL and anon key. It is used for Auth operations only in this phase.

### `lib/supabase/proxy.ts`

Refreshes or verifies the Supabase token and copies all returned cookies and cache-control headers to the outgoing `NextResponse`.

### `lib/dal/admin-client.ts`

Owns creation of the service-role client and is marked `server-only`. No page, Client Component, or feature component imports it directly. Feature pages and mutations obtain the privileged client only through the authenticated request context. Internal server-only reference-data DAL functions may construct it without returning the client, but they expose only explicitly selected non-user-specific policy data.

### `lib/auth/permissions.ts`

Contains pure role and resource permission predicates currently mixed into `lib/auth.ts`. These functions contain no cookie, database, or Supabase dependencies.

### `lib/auth/session.ts`

Defines the authenticated actor and request-scoped identity operations:

```ts
type Actor = {
  authUserId: string;
  userId: string;
  email: string;
  role: "employee" | "manager" | "admin";
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    department?: string;
  } | null;
};

verifyActor(): Promise<Actor | null>
requireActor(): Promise<Actor>
```

`verifyActor()` is wrapped in React `cache()` without user-controlled cache keys. Its lifetime is one server request/render only. It does not use `unstable_cache`, the Data Cache, or any cross-request cache.

The function verifies Supabase claims, loads `public.users` through `auth_user_id`, loads the employee row, and rejects inactive or unlinked accounts. Admin is the only role allowed without an employee row.

### `lib/dal/request-context.ts`

Creates the privileged request capability:

```ts
type RequestContext = {
  actor: Actor;
  db: SupabaseClient;
};

requireRequestContext(): Promise<RequestContext>
```

The service-role client is not created or returned until actor verification succeeds. Server Components and Server Actions use this context while retaining their existing page-level and resource-level authorization checks.

### `lib/auth/actions.ts`

Exports only the login and logout Server Actions. Both validate their input and use the cookie-backed SSR Auth client.

### Existing pages and actions

- Replace mock-cookie parsing with `requireActor()` or `requireRequestContext()`.
- Preserve all existing role, direct-report, ownership, pending-state, and active-status authorization.
- Do not move privileged data or secrets into Client Components.
- Do not call an application Route Handler from a Server Component.

## Login and Logout

The login form invokes a Server Action rather than the current mock-login Route Handler:

```text
FormData
  -> Zod email/password validation
  -> supabase.auth.signInWithPassword()
  -> verify linked active Actor
  -> redirect("/")
```

Invalid email/password combinations return one generic expected message. This avoids disclosing whether a fake demo account exists. Unlinked and inactive users are immediately signed out and shown a generic access-denied message.

Unexpected Auth or database failures are logged server-side and are not reported as invalid credentials, not found, or validation failures.

Logout invokes `supabase.auth.signOut()` in a Server Action and redirects to `/login`. The browser no longer writes or clears authentication cookies itself.

The following mock-auth code is removed:

- `app/api/auth/mock-login/route.ts`
- `setMockSession()`
- `clearMockSession()`
- `getMockSessionFromCookie()`
- `getSessionFromRequest()`
- the `leavehub_mock_user` cookie

Legacy mock cookies grant no access after deployment.

## Proxy and Cache Behavior

`proxy.ts` delegates token refresh to `lib/supabase/proxy.ts`. The helper applies Supabase cookie changes and the associated private/no-store response headers. Authenticated routes must remain dynamic and must never enter ISR or a shared CDN cache.

The proxy may redirect a request with no verified claims to `/login`, but pages and Server Actions still verify their actor. This preserves security when proxy matching changes, a prefetched request is replayed, or a Server Action is invoked directly.

No authorization decision is cached across users or requests.

## RLS Hardening

The identity migration updates the existing SECURITY DEFINER helpers:

```sql
public.current_user_role_is(check_roles text[])
public.current_employee_id()
```

Both helpers resolve the application user through:

```sql
public.users.auth_user_id = auth.uid()
```

The migration rewrites every remaining policy that directly assumes Auth IDs are application IDs:

```text
Users can read own record
  auth.uid() = users.auth_user_id

Employees can read own record
  employees.id = public.current_employee_id()

Employees can read own balances
  leave_balances.employee_id = public.current_employee_id()
```

Manager and admin policies that call the SECURITY DEFINER helpers inherit the new mapping after those helpers are replaced.

The migration also drops:

```text
dev_allow_all_leave_grants
dev_allow_all_leave_request_days
```

Those tables remain RLS-enabled with no browser policy during this phase, so anon and caller-scoped clients are denied by default. The server-only service role continues to access them after application authorization. Adding complete caller-scoped policies is reserved for a future RLS-first hardening phase.

The private MC bucket remains service-role only; no public storage policy is added.

## Demo Auth Bootstrap

An explicit script is exposed as:

```bash
npm run auth:bootstrap-demo
```

It requires:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DEMO_AUTH_PASSWORD
ALLOW_DEMO_AUTH_BOOTSTRAP=true
```

The script refuses to run without the safety flag. It performs the following idempotent flow:

1. Load all `public.users` rows with their email and identity link.
2. Normalize email addresses for comparison.
3. Enumerate the relevant Supabase Auth users through the admin API.
4. For an existing matching Auth user, verify that it is not linked to another LeaveHub user.
5. For an unlinked LeaveHub user with no matching Auth user, create a confirmed Auth account with the environment-provided demo password.
6. Set or confirm `public.users.auth_user_id`.
7. Update the demo password for the linked Auth user so repeated runs converge.
8. Exit nonzero on duplicate emails, conflicting links, missing application rows, or remote failures.

The script never prints the password and no demo password is committed. It is not invoked automatically by application startup, build, migration, or deployment.

## Environment Configuration

Application runtime:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Explicit local/demo bootstrap only:

```text
DEMO_AUTH_PASSWORD
ALLOW_DEMO_AUTH_BOOTSTRAP=true
```

The resolved `@supabase/ssr` version is pinned exactly because Supabase currently labels the package beta and warns that its API may change.

## Error Model

Expected errors are returned as typed form state:

- malformed email or password input;
- invalid credentials;
- valid Auth account without LeaveHub access;
- inactive employee;
- stale or missing session.

Unexpected errors are logged and surfaced through a generic unavailable message or the nearest error boundary:

- Supabase Auth outage;
- token verification failure caused by infrastructure;
- database lookup failure;
- bootstrap admin API failure;
- identity-link conflict requiring operator intervention.

Raw Auth, PostgreSQL, service-role, connection, or storage details are never returned to the browser.

## Testing Strategy

Development follows TDD with a failing test observed before each behavior change.

### Unit and service tests

- Login schema rejects missing, malformed, and oversized inputs.
- Invalid credentials produce the generic expected response.
- Linked active employee, manager, and admin resolve to the correct Actor.
- Admin resolves successfully without an employee row.
- Unlinked users are denied and signed out.
- Inactive employees are denied and signed out.
- Auth/database failures remain unexpected failures rather than credential or not-found errors.
- `verifyActor()` is deduplicated within a request and not cached across requests.
- Bootstrap creates missing demo identities, updates existing ones, and is idempotent.
- Bootstrap rejects duplicate email and conflicting identity links.

### Browser tests

- Demo email/password login succeeds for employee, manager, and admin.
- Invalid credentials remain on `/login` with a generic error.
- Protected routes redirect when no Supabase session exists.
- A forged legacy mock cookie does not authorize a request.
- Logout invalidates the Supabase session and returns to `/login`.
- An inactive employee loses access on the next verified request.
- Direct `/approvals` access remains blocked for employees.

Browser tests read the demo password from an environment variable. They never embed it in source.

### Migration and build verification

- Verify existing application IDs and foreign-key relationships are unchanged.
- Verify existing users are backfilled to `auth_user_id = id`.
- Verify anon access to `leave_grants` and `leave_request_days` is denied.
- Run focused lint, the guardrail suite, relevant browser tests, and `npm run build`.
- Inspect the production client bundle to confirm the service-role key and privileged modules are absent.

If remote Supabase connectivity is unavailable, browser/database verification is reported as blocked rather than inferred from static analysis.

## Deployment and Rollback

Deployment uses an expand/migrate/cutover sequence:

1. Apply the backward-compatible identity and RLS migration.
2. Verify existing `auth.users` and `public.users` links.
3. Run the explicit demo bootstrap.
4. Configure runtime environment variables.
5. Deploy the Phase 2 application.
6. Verify login, token refresh, logout, inactive-user denial, and all three roles.

No existing application IDs or downstream foreign keys are removed. The old application version continues to work after the database migration because it still looks users up by email and uses the service role. This permits an application rollback while the new identity column remains in place.

The old mock endpoint and helpers are removed from the new code, but no database column is contracted in this phase.

## Out of Scope

- Google OAuth or another production identity provider.
- Password reset and email delivery for fake accounts.
- Public self-signup.
- Automatic bootstrap during deployment or startup.
- Full conversion from service-role queries to caller-scoped RLS clients.
- Query-count optimization and authorization deduplication beyond the new request-scoped actor/context.
- Transactional mutation redesign.
- Cache redesign, streaming changes, or client-side revalidation.
- Rate-limit configuration outside Supabase Auth's existing controls.

## Acceptance Criteria

Phase 2 is complete when:

1. No browser-written mock cookie can authenticate a user.
2. Demo users authenticate through Supabase email/password and SSR cookies.
3. Every protected render and Server Action derives an Actor from verified Supabase identity.
4. Roles and employee status come only from LeaveHub tables.
5. Feature pages and mutations obtain the service-role client only through an authenticated server-only request context; internal reference-data DAL functions never expose that client.
6. Existing application IDs and authorization boundaries remain unchanged.
7. Anonymous access to later grant and per-day tables is removed.
8. Demo account provisioning is explicit, idempotent, conflict-safe, and secret-free in source.
9. Expected auth errors and unexpected infrastructure errors remain distinguishable.
10. Relevant tests, lint, build, and independent review pass, with external blockers explicitly documented.
