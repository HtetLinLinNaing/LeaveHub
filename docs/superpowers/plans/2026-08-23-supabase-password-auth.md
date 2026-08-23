# Supabase Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LeaveHub's browser-written mock cookie with Supabase email/password authentication for demo users while preserving application IDs, authorization rules, and tenant/resource boundaries.

**Architecture:** A cookie-backed Supabase SSR client verifies identity. React `cache()` memoizes that verification only for the current request. An authenticated request context then grants Server Components and Server Actions access to the server-only service-role database client. Proxy refreshes Auth cookies and performs only an optimistic redirect; authorization remains at each data entry point.

**Tech Stack:** Next.js 16.3.0 App Router and Proxy, React 19.2.8 `cache()`/`useActionState`, TypeScript 5, Supabase JS 2.112.2, Supabase SSR 0.12.4, PostgreSQL/RLS, Zod 4.4.3, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-23-supabase-password-auth-design.md`

## Global Constraints

- Read the relevant installed Next.js 16.3 documentation before each framework-sensitive change: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `node_modules/next/dist/docs/01-app/02-guides/mutating-data.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
- Follow the official Supabase SSR server-client pattern and the installed `@supabase/ssr@0.12.4` types. Use `getClaims()`, never `getSession()`, for trusted identity.
- Preserve every Phase 1 role, ownership, manager-scope, active-status, and pending-state authorization check.
- Never expose or pass the service-role client to a Client Component. Never cache an actor, authorization decision, or privileged client across requests.
- Keep login errors non-enumerating. Log unexpected Auth/database failures server-side; do not relabel them as invalid credentials or not-found errors.
- Do not call a Route Handler from a Server Component. Login/logout are same-application mutations and remain Server Actions.
- Do not add Google OAuth, signup, password reset, client-side data fetching, cross-request user caching, or a full caller-scoped RLS conversion in this phase.
- Run focused tests after every green step. Run the full production build and E2E suite before requesting review or opening the Phase 2 PR.

---

## Task 1: Pin the SSR dependency and add the identity/RLS migration

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `supabase/migrations/009_supabase_password_auth.sql`
- Create: `tests/phase2-auth-contract.spec.ts`
- Modify: `playwright.unit.config.ts`

- [ ] **Step 1: Write the failing migration contract tests**

Add `tests/phase2-auth-contract.spec.ts`. Read migration `009_supabase_password_auth.sql` with `readFileSync` and assert the security invariants, not whitespace:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const migration = readFileSync(
  new URL("../supabase/migrations/009_supabase_password_auth.sql", import.meta.url),
  "utf8"
);

test.describe("Phase 2 authentication contracts", () => {
  test("maps Auth identities without changing application IDs", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS auth_user_id UUID");
    expect(migration).toContain("SET auth_user_id = id");
    expect(migration).toContain("REFERENCES auth.users(id) ON DELETE SET NULL");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS users_id_fkey");
  });

  test("resolves RLS identity through auth_user_id", () => {
    expect(migration).toContain("WHERE auth_user_id = auth.uid()");
    expect(migration).toContain("JOIN users u ON u.id = e.user_id");
    expect(migration).toContain("u.auth_user_id = auth.uid()");
  });

  test("removes anonymous policies on post-RLS tables", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "dev_allow_all_leave_grants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "dev_allow_all_leave_request_days"');
  });
});
```

Change `playwright.unit.config.ts` to:

```ts
testMatch: ["phase1-guardrails.spec.ts", "phase2-auth-contract.spec.ts"],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL because migration 009 does not exist.

- [ ] **Step 3: Write the migration**

Create `009_supabase_password_auth.sql` with this sequence:

```sql
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

UPDATE public.users
SET auth_user_id = id
WHERE auth_user_id IS NULL;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

CREATE OR REPLACE FUNCTION public.current_user_role_is(check_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_user_id = auth.uid() AND role::text = ANY(check_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  JOIN users u ON u.id = e.user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1
$$;

DROP POLICY IF EXISTS "Users can read own record" ON users;
CREATE POLICY "Users can read own record" ON users
  FOR SELECT USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Employees can read own record" ON employees;
CREATE POLICY "Employees can read own record" ON employees
  FOR SELECT USING (id = public.current_employee_id());

DROP POLICY IF EXISTS "Employees can read own balances" ON leave_balances;
CREATE POLICY "Employees can read own balances" ON leave_balances
  FOR SELECT USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS "dev_allow_all_leave_grants" ON leave_grants;
DROP POLICY IF EXISTS "dev_allow_all_leave_request_days" ON leave_request_days;

COMMIT;
```

Before applying this migration to any shared environment, query `pg_constraint` and `pg_policies` and compare names with migrations 003–008. Apply in a disposable/local Supabase database first. Verify that every pre-existing `public.users` row has a matching `auth.users` row; abort the deployment if the backfill violates the FK or unique constraint.

- [ ] **Step 4: Pin the installed SSR version**

Change `"@supabase/ssr": "^0.12.4"` to `"@supabase/ssr": "0.12.4"` and run `npm install --package-lock-only` so the manifest and lockfile agree.

- [ ] **Step 5: Run focused verification**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: 3 passed.

Run: `npm ls @supabase/ssr @supabase/supabase-js --depth=0`

Expected: `@supabase/ssr@0.12.4` and `@supabase/supabase-js@2.112.2` with no invalid dependency marker.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json playwright.unit.config.ts tests/phase2-auth-contract.spec.ts supabase/migrations/009_supabase_password_auth.sql
git commit -m "feat(auth): add Auth identity mapping"
```

---

## Task 2: Build testable Supabase SSR clients and Proxy refresh

**Files:**

- Create: `lib/supabase/env.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/proxy.ts`
- Modify: `proxy.ts`
- Modify: `tests/phase2-auth-contract.spec.ts`

- [ ] **Step 1: Add failing tests for environment validation and proxy routing**

Export pure functions `readSupabasePublicEnv(env)` and `isPublicPath(pathname)`. Test that missing URL/key throws, `/login` is public, assets are excluded by the matcher, and `/`, `/leave`, and Server Action POSTs remain protected.

```ts
expect(() => readSupabasePublicEnv({})).toThrow("Missing NEXT_PUBLIC_SUPABASE_URL");
expect(isPublicPath("/login")).toBe(true);
expect(isPublicPath("/leave")).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement the public environment reader**

`lib/supabase/env.ts` must expose only public credentials:

```ts
export function readSupabasePublicEnv(env: NodeJS.ProcessEnv = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, key };
}
```

- [ ] **Step 4: Implement the server Auth client**

`lib/supabase/server.ts` must be `server-only`, call `cookies()`, and create a new `createServerClient` per invocation. Its cookie adapter uses `getAll()` and `setAll()`. Catch the known Server Component cookie-write exception only around `cookieStore.set`; Server Actions must be able to persist login/logout cookies.

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabasePublicEnv } from "./env";

export async function createAuthClient() {
  const cookieStore = await cookies();
  const { url, key } = readSupabasePublicEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Proxy owns refresh writes during Server Component rendering.
        }
      },
    },
  });
}
```

- [ ] **Step 5: Implement refresh and optimistic redirect**

`lib/supabase/proxy.ts` must create an SSR client from `request.cookies`, call `auth.getClaims()`, copy every cookie mutation to both the request and the final response, and return `{ response, authenticated }`. It must not query application tables.

`proxy.ts` must await that helper, redirect unauthenticated protected requests to `/login`, redirect authenticated `/login` requests to `/`, and preserve refreshed cookies on redirects by copying them from the refresh response. Keep the negative matcher for `_next/static`, `_next/image`, favicon, and common static extensions.

- [ ] **Step 6: Run focused tests and build**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: all Phase 2 contract tests pass.

Run: `npm run build`

Expected: Next.js 16.3 production build passes; no Edge-runtime warning (Proxy is Node.js in Next 16).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/env.ts lib/supabase/server.ts lib/supabase/proxy.ts proxy.ts tests/phase2-auth-contract.spec.ts
git commit -m "feat(auth): refresh Supabase SSR sessions"
```

---

## Task 3: Introduce the request-scoped actor and privileged DAL boundary

**Files:**

- Create: `lib/auth/permissions.ts`
- Create: `lib/auth/actor.ts`
- Create: `lib/auth/session.ts`
- Create: `lib/dal/admin-client.ts`
- Create: `lib/dal/request-context.ts`
- Modify: `lib/auth.ts`
- Modify: `lib/supabase/admin.ts`
- Modify: `lib/cache.ts`
- Modify: `tests/phase1-guardrails.spec.ts`
- Modify: `tests/phase2-auth-contract.spec.ts`

- [ ] **Step 1: Write failing actor-resolution tests**

Test an exported dependency-injected `resolveActor(authUserId, email, db)` from `lib/auth/actor.ts` with a small Supabase query fake. Keeping this pure resolver separate avoids importing `server-only` framework modules into the Playwright Node test process. Cover:

- linked active employee returns the approved `Actor` shape;
- linked admin without an employee row is accepted;
- unlinked Auth ID returns `null`;
- inactive employee returns `null`;
- employee/manager without an employee row returns `null`;
- database failures reject instead of becoming logout;
- permission predicates preserve Phase 1 results.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase1-guardrails.spec.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL because the actor and permissions modules do not exist.

- [ ] **Step 3: Move pure permissions without behavioral changes**

Move `hasRole`, `canApproveLeave`, `canViewApprovals`, `canManageEmployees`, `canProposeGrants`, and `canManageGrants` from `lib/auth.ts` to `lib/auth/permissions.ts`. Update imports in pages/actions. Do not broaden any role list.

- [ ] **Step 4: Move the service-role constructor behind the DAL**

Create `lib/dal/admin-client.ts` with `import "server-only"` and the existing non-persistent service-role client construction. Rename the export to `createAdminClient`.

Change `lib/supabase/admin.ts` into a temporary server-only compatibility re-export:

```ts
export { createAdminClient as createClient } from "@/lib/dal/admin-client";
```

Update `lib/cache.ts` to import `createAdminClient` directly. This module is the approved exception because it returns only explicitly selected non-user-specific reference data and never exposes the client.

- [ ] **Step 5: Implement actor verification**

`lib/auth/actor.ts` defines the approved `Actor` and the dependency-injected `resolveActor`. `lib/auth/session.ts` re-exports the `Actor` type and wraps the no-argument verifier in React `cache()`:

```ts
export type Actor = {
  authUserId: string;
  userId: string;
  email: string;
  role: Role;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    department?: string;
  } | null;
};

const verifyActorUncached = async (): Promise<Actor | null> => {
  const auth = await createAuthClient();
  const { data, error } = await auth.auth.getClaims();
  if (error) {
    if (
      isAuthSessionMissingError(error) ||
      error instanceof AuthInvalidJwtError
    ) return null;
    throw error;
  }
  if (!data?.claims?.sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return resolveActor(data.claims.sub, email, createAdminClient());
};

export const verifyActor = cache(verifyActorUncached);

export async function requireActor(): Promise<Actor> {
  const actor = await verifyActor();
  if (!actor) redirect("/login");
  return actor;
}
```

`resolveActor` must select `id,email,role` from `users` by `auth_user_id`, then select `id,first_name,last_name,department,status` from `employees` by `user_id`. It must throw query errors, use the database email as the rendered email, and enforce the active/admin rules above. Missing/invalid sessions return `null`; retryable Auth failures, database failures, and network outages throw.

- [ ] **Step 6: Implement the authenticated request context**

`lib/dal/request-context.ts`:

```ts
import "server-only";
import { cache } from "react";
import { requireActor } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/dal/admin-client";

export const requireRequestContext = cache(async () => ({
  actor: await requireActor(),
  db: createAdminClient(),
}));
```

The service-role client must be constructed after actor verification, not before it.

- [ ] **Step 7: Remove the old session implementation**

Delete mock-cookie functions, types, and `getCurrentEmployee` from `lib/auth.ts`. Keep `lib/auth.ts` only as a temporary permission re-export if needed for an atomic migration; no browser cookie code may remain. Update the Phase 1 database-failure test to exercise `resolveActor`.

- [ ] **Step 8: Run tests and commit**

Run: `npx playwright test --config=playwright.unit.config.ts`

Expected: all guardrail and actor tests pass.

Run: `npm run lint -- lib/auth lib/dal lib/supabase lib/cache.ts tests/phase1-guardrails.spec.ts tests/phase2-auth-contract.spec.ts`

Expected: no errors.

```bash
git add lib/auth.ts lib/auth/permissions.ts lib/auth/actor.ts lib/auth/session.ts lib/dal lib/supabase/admin.ts lib/cache.ts tests/phase1-guardrails.spec.ts tests/phase2-auth-contract.spec.ts
git commit -m "refactor(auth): add request-scoped actor DAL"
```

---

## Task 4: Replace mock login/logout with Server Actions

**Files:**

- Create: `lib/auth/actions.ts`
- Create: `lib/auth/password.ts`
- Modify: `lib/validations.ts`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `components/shared/sidebar.tsx`
- Delete: `app/api/auth/mock-login/route.ts`
- Modify: `tests/phase2-auth-contract.spec.ts`

- [ ] **Step 1: Write failing validation and login-result tests**

Add `loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).strict()`. Test malformed email, empty/oversized password, extra fields, generic invalid-credential output, unlinked actor sign-out, and unexpected failure sanitization. Put the dependency-injected `authenticatePassword(input, dependencies)` workflow in `lib/auth/password.ts`, which has no Next.js or `server-only` imports. The exported Server Action is a thin FormData adapter around it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL because `loginSchema` and auth actions do not exist.

- [ ] **Step 3: Implement login/logout actions**

`lib/auth/actions.ts` begins with `"use server"` and exports:

```ts
export type LoginState = { error?: string };

export async function login(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState>;

export async function logout(): Promise<void>;
```

Login parses FormData with Zod, delegates to `authenticatePassword`, and calls `redirect("/")` outside `try/catch` after success. The injected workflow calls `signInWithPassword`, loads the linked actor by returned `user.id`, signs out if actor resolution fails, returns `Invalid email or password.` for non-retryable rejected credentials, returns `Your account is not enabled for LeaveHub.` for linked-access rejection, and throws retryable/network/database failures so the action can log them and return `Sign in is temporarily unavailable.`.

Logout calls `auth.signOut()`, logs unexpected failures, then calls `redirect("/login")` outside `try/catch`.

- [ ] **Step 4: Convert the login form to `useActionState`**

Keep `app/(auth)/login/page.tsx` as a small Client Component. Replace `fetch`, router usage, and local loading state with:

```tsx
const [state, formAction, pending] = useActionState(login, {});

<form action={formAction} className="space-y-4">
  <input id="email" name="email" type="email" autoComplete="email" required />
  <input id="password" name="password" type="password" autoComplete="current-password" required />
  {state.error && <p role="alert">{state.error}</p>}
  <Button type="submit" disabled={pending}>
    {pending ? "Signing in..." : "Sign in"}
  </Button>
</form>
```

Change the footer to `Demo accounts use credentials provisioned by the administrator.`

- [ ] **Step 5: Convert logout and delete the Route Handler**

In `components/shared/sidebar.tsx`, remove `useRouter`, `clearMockSession`, and `handleLogout`. Render a server-action form around the button:

```tsx
<form action={logout}>
  <button type="submit" className="...">
    <LogOut className="h-4 w-4" />
    Sign out
  </button>
</form>
```

Delete `app/api/auth/mock-login/route.ts`. Confirm `rg -n 'mock-login|leavehub_mock_user|setMockSession|clearMockSession' app components lib` returns no matches.

- [ ] **Step 6: Run tests, build, and commit**

Run: `npx playwright test --config=playwright.unit.config.ts`

Run: `npm run build`

Expected: both pass; route output no longer lists `/api/auth/mock-login`.

```bash
git add -A app/api/auth/mock-login app/'(auth)'/login/page.tsx components/shared/sidebar.tsx lib/auth/actions.ts lib/auth/password.ts lib/validations.ts tests/phase2-auth-contract.spec.ts
git commit -m "feat(auth): use password login Server Actions"
```

---

## Task 5: Migrate every protected Server Component to the request context

**Files:**

- Modify: `app/(dashboard)/layout.tsx`
- Modify: `app/(dashboard)/page.tsx`
- Modify: `app/(dashboard)/leave/page.tsx`
- Modify: `app/(dashboard)/approvals/page.tsx`
- Modify: `app/(dashboard)/employees/page.tsx`
- Modify: `app/(dashboard)/calendar/page.tsx`
- Modify: `app/(dashboard)/policies/page.tsx`
- Modify: `tests/phase2-auth-contract.spec.ts`

- [ ] **Step 1: Add a failing import-boundary test**

Read the seven protected page/layout files and assert they do not import `next/headers`, `lib/auth` mock helpers, or `lib/supabase/admin`; pages that query privileged data must import `requireRequestContext`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL on the current cookie/admin imports.

- [ ] **Step 3: Migrate the shared layout**

Replace cookie parsing and user lookup with:

```ts
const actor = await requireActor();
<Sidebar role={actor.role} email={actor.email} />
```

This layout check improves navigation UX but is not treated as the authorization boundary.

- [ ] **Step 4: Migrate user-specific pages**

For dashboard, leave, approvals, and employees pages, begin with:

```ts
const { actor, db } = await requireRequestContext();
```

Then make these exact substitutions throughout each file:

- `supabase` -> `db`;
- `user.role` -> `actor.role`;
- `employee.id` -> `actor.employee.id` after the existing null guard;
- `employee.first_name` -> `actor.employee.firstName`;
- `employee?.id` -> `actor.employee?.id`.

Preserve the existing admin redirect on `/leave`, approvals role check, manager employee requirement, manager direct-report prefilter, and all query shapes. Do not use layout authorization as a replacement.

- [ ] **Step 5: Migrate calendar and policies**

Call `requireRequestContext()` at the top of both pages even though the layout also verifies. Calendar uses its returned `db`. Policies requires the context for entry-point authorization and continues to use only the reference-data DAL functions for its payload.

- [ ] **Step 6: Run verification and commit**

Run: `npx playwright test --config=playwright.unit.config.ts`

Run: `npm run lint -- 'app/(dashboard)'`

Run: `npm run build`

Expected: all pass. `rg -n 'cookies\(|getCurrentEmployee|getSessionFromRequest|lib/supabase/admin' 'app/(dashboard)'` returns no matches.

```bash
git add 'app/(dashboard)' tests/phase2-auth-contract.spec.ts
git commit -m "refactor(auth): secure dashboard data access"
```

---

## Task 6: Migrate all mutation entry points to verified request context

**Files:**

- Modify: `lib/actions.ts`
- Modify: `tests/phase1-guardrails.spec.ts`
- Modify: `tests/phase2-auth-contract.spec.ts`
- Delete: `lib/supabase/admin.ts`
- Delete: `lib/auth.ts`

- [ ] **Step 1: Write a failing Server Action boundary test**

Assert that `lib/actions.ts` imports `requireRequestContext`, does not import `cookies`, old auth session helpers, or the admin constructor, and still imports permission predicates from `lib/auth/permissions`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test --config=playwright.unit.config.ts tests/phase2-auth-contract.spec.ts`

Expected: FAIL on the current `requireSession` implementation.

- [ ] **Step 3: Replace the action session helper**

Delete `requireSession()`. In each of the twelve exported actions, use:

```ts
const { actor, db } = await requireRequestContext();
```

Apply these exact semantic mappings:

- `supabase` -> `db` for all queries/storage calls;
- `user.role` and the separate `role` value -> `actor.role`;
- `employee` -> `actor.employee`;
- `employee.id` -> `actor.employee.id` only after the existing null check.

Migrate all twelve exports: `approveLeaveRequest`, `createEmployee`, `updateEmployeeStatus`, `createLeaveRequest`, `uploadMcCertificate`, `cancelLeaveRequest`, `createHoliday`, `deleteHoliday`, `updateLeaveTypeDays`, `createLeaveGrant`, `approveLeaveGrant`, and `cancelPendingGrant`.

Do not delete or weaken any validation or resource authorization. Every action remains independently authenticated even when invoked from a protected page. Update `ensureBucket`'s client type to `SupabaseClient` or `RequestContext["db"]`; it must not call authentication itself.

- [ ] **Step 4: Remove compatibility modules**

Update every remaining server import to `lib/dal/admin-client` or `lib/auth/permissions`, then delete `lib/supabase/admin.ts` and `lib/auth.ts`.

Run: `rg -n 'lib/supabase/admin|from "@/lib/auth"|leavehub_mock_user|getCurrentEmployee|getSessionFromRequest|requireSession' app components lib tests`

Expected: no matches.

- [ ] **Step 5: Run tests/build and commit**

Run: `npx playwright test --config=playwright.unit.config.ts`

Run: `npm run lint -- lib/actions.ts lib/auth lib/dal tests`

Run: `npm run build`

Expected: all pass.

```bash
git add -A lib tests
git commit -m "refactor(auth): verify every mutation actor"
```

---

## Task 7: Add the explicit idempotent demo-user bootstrap

**Files:**

- Create: `scripts/bootstrap-demo-auth.mjs`
- Create: `scripts/bootstrap-demo-auth-core.mjs`
- Create: `tests/bootstrap-demo-auth.spec.ts`
- Modify: `package.json`
- Modify: `.env.local.example`
- Modify: `playwright.unit.config.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Export `normalizeEmail`, `indexAuthUsers`, and `planDemoAuthChanges(publicUsers, authUsers)` from the core module. Test:

- email normalization uses `trim().toLowerCase()`;
- an existing matching Auth user is linked, not recreated;
- an already linked user is updated idempotently;
- a missing Auth user is planned for creation;
- duplicate normalized Auth emails throw;
- conflicting `auth_user_id` or mismatched email throws;
- password values never appear in the returned plan or logged summary.

Add `bootstrap-demo-auth.spec.ts` to unit `testMatch`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test --config=playwright.unit.config.ts tests/bootstrap-demo-auth.spec.ts`

Expected: FAIL because the core module does not exist.

- [ ] **Step 3: Implement deterministic reconciliation**

The core planner returns operations with only IDs/emails:

```js
{
  create: [{ publicUserId, email }],
  updatePassword: [{ authUserId, email }],
  link: [{ publicUserId, authUserId, email }]
}
```

It must fail before mutations if any normalized email is duplicated, a public link points at an Auth identity with another email, or two public users would link to one Auth ID.

- [ ] **Step 4: Implement the explicit script**

`scripts/bootstrap-demo-auth.mjs` must:

1. load `.env.local` with Node's supported environment-file mechanism via the package script;
2. require `ALLOW_DEMO_AUTH_BOOTSTRAP === "true"`, Supabase URL, service key, and `DEMO_AUTH_PASSWORD` of at least 12 characters;
3. create a non-persistent service-role Supabase client;
4. load `public.users(id,email,auth_user_id)`;
5. page through `auth.admin.listUsers({ page, perPage: 1000 })` until fewer than 1000 results;
6. calculate and validate the full plan before writing;
7. create missing identities with `email_confirm: true` and the shared demo password;
8. update every existing identity's password with `auth.admin.updateUserById`;
9. update `public.users.auth_user_id` with `.eq("id", publicUserId)` and require one returned row;
10. print counts and emails only, never the password or service key;
11. exit non-zero on the first conflict or failed API/database operation.

Add:

```json
"auth:bootstrap-demo": "node --env-file=.env.local scripts/bootstrap-demo-auth.mjs"
```

Add documented demo-only variables to `.env.local.example`:

```dotenv
# Demo environments only. Never enable this command in a real-user environment.
ALLOW_DEMO_AUTH_BOOTSTRAP=false
DEMO_AUTH_PASSWORD=replace-with-at-least-12-characters
```

- [ ] **Step 5: Run tests and a safe failure check**

Run: `npx playwright test --config=playwright.unit.config.ts tests/bootstrap-demo-auth.spec.ts`

Expected: all reconciliation tests pass.

Run without enabling the flag: `npm run auth:bootstrap-demo`

Expected: non-zero exit before any network call, with a message requiring `ALLOW_DEMO_AUTH_BOOTSTRAP=true`.

- [ ] **Step 6: Commit**

```bash
git add package.json .env.local.example playwright.unit.config.ts scripts/bootstrap-demo-auth.mjs scripts/bootstrap-demo-auth-core.mjs tests/bootstrap-demo-auth.spec.ts
git commit -m "feat(auth): bootstrap demo Auth users"
```

---

## Task 8: Update E2E authentication coverage and deployment documentation

**Files:**

- Modify: `tests/helpers.ts`
- Modify: `tests/auth.spec.ts`
- Modify: `supabase/migrations/README.md`
- Modify: `README.md` if it contains local setup instructions
- Modify: `docs/superpowers/specs/2026-08-23-supabase-password-auth-design.md` only if implementation evidence requires an explicit deviation note

- [ ] **Step 1: Update E2E helpers before running the app**

Require `DEMO_AUTH_PASSWORD` in the Playwright process. Update `login` to fill both email and password. Update auth assertions to expect the generic invalid-credential message, password input, server-action logout, and persistence after reload. Add an assertion that manually setting the legacy `leavehub_mock_user` cookie does not authenticate.

```ts
const DEMO_PASSWORD = process.env.DEMO_AUTH_PASSWORD;
if (!DEMO_PASSWORD) throw new Error("Missing DEMO_AUTH_PASSWORD for E2E auth tests");

await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', DEMO_PASSWORD);
```

- [ ] **Step 2: Document safe deployment order**

In the migration README/local setup docs, record:

1. back up the database;
2. verify migrations 003–008 and Auth/public user ID correspondence;
3. apply migration 009;
4. set `DEMO_AUTH_PASSWORD` and one-time `ALLOW_DEMO_AUTH_BOOTSTRAP=true` locally/administratively;
5. run `npm run auth:bootstrap-demo` and review counts;
6. set the flag back to false/remove it;
7. deploy the new app;
8. smoke test employee, manager, and admin;
9. remove obsolete `leavehub_mock_user` browser cookies only as optional cleanup because they no longer grant access.

Include rollback semantics: migration 009 is expand-compatible with the old app until the old app is retired; do not drop `auth_user_id` during an incident rollback. Roll back application code first, investigate identity links, and never restore anonymous RLS policies.

- [ ] **Step 3: Apply migration/bootstrap only to an approved disposable environment**

Run the SQL migration through the project's normal Supabase migration mechanism. Then run the explicit bootstrap once with the approved demo password. Record row counts, not credentials, in the PR verification notes.

If a disposable/local Supabase or approved remote project is unavailable, do not target production. Mark database/E2E results as blocked and retain static/unit/build evidence.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts
npm run lint
npm run build
npm test
```

Expected:

- unit guardrail/auth/bootstrap tests pass;
- lint passes;
- Next.js 16.3 production build passes;
- E2E auth, role access, leave, approvals, calendar, employees, policies, grants, and mobile tests pass against the migrated/bootstrap environment.

Perform manual checks:

- invalid credentials reveal no account-existence detail;
- employee cannot access `/approvals` or invoke approval actions;
- manager sees only permitted direct-report requests;
- admin without an employee row can log in and use admin pages;
- inactive/unlinked user is signed out;
- logout invalidates refresh/navigation;
- legacy mock cookie grants no access;
- Network/Application inspection shows HttpOnly Supabase cookies and no service-role key in browser assets, RSC payloads, or responses.

- [ ] **Step 5: Commit documentation/test updates**

```bash
git add tests/helpers.ts tests/auth.spec.ts supabase/migrations/README.md README.md docs/superpowers/specs/2026-08-23-supabase-password-auth-design.md
git commit -m "test(auth): verify password session lifecycle"
```

Omit unchanged files from `git add` if no implementation deviation was necessary.

---

## Task 9: Independent review, final evidence, push, and PR

**Files:**

- Review: all Phase 2 commits and the complete diff from `main`

- [ ] **Step 1: Inspect scope and secrets**

Run:

```bash
git status --short
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline main..HEAD
rg -n 'SUPABASE_SERVICE_ROLE_KEY|DEMO_AUTH_PASSWORD|leavehub_mock_user|mock-login' app components lib scripts tests .env.local.example
```

Expected: only intentional references to server-side env names/bootstrap checks and the negative legacy-cookie test; no credential values; no mock endpoint/session implementation.

- [ ] **Step 2: Request independent code review**

Use `superpowers:requesting-code-review`. Ask the reviewer to focus on authentication trust, SSR cookie propagation, request-scoped cache lifetime, service-role import boundaries, every Server Action's resource authorization, RLS identity mapping, bootstrap conflicts/idempotence, error enumeration, and migration rollback safety.

- [ ] **Step 3: Address findings with the proper workflow**

Use `superpowers:receiving-code-review`. Reproduce and verify each finding before changing code. Add a regression test first for every accepted behavioral/security fix, then commit the fix separately.

- [ ] **Step 4: Re-run completion verification**

Use `superpowers:verification-before-completion`, then rerun the full matrix from Task 8 and record exact pass/fail counts and any environment limitation.

- [ ] **Step 5: Push and open the Phase 2 PR**

Push `feat/phase-2-supabase-auth` and create a PR to `main`. The PR body must include:

- the identity/RLS migration and deployment sequence;
- Auth/DAL/Server Action architecture;
- explicit authorization invariants preserved;
- bootstrap safety/idempotence behavior;
- exact verification commands/results;
- migration/E2E environment limitations, if any;
- rollback guidance.

Do not merge automatically. Wait for CI and user approval.
