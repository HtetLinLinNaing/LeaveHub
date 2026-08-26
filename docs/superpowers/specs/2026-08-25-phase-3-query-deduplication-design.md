# Phase 3 Query and Authorization Deduplication Design

Date: 2026-08-25
Status: approved in chat for specification
Base: `main` after Phase 2 PR #33

## Goal

Reduce database round trips and sequential query waterfalls on the authenticated
dashboard, leave, approvals, and calendar routes without weakening actor,
resource, or manager-scope authorization. Keep data fetching on the server and
preserve the existing UI and mutation contracts.

Phase 3 is deliberately smaller than Phase 2. It changes read orchestration and
shared server-only query code only. It does not introduce a public API, client
fetching, new cross-request caches, or database migrations.

## Installed-framework basis

The project uses Next.js 16.3.0 without the `cacheComponents` flag and React
19.2.8. The installed Next.js guidance supports direct database access from
Server Components, recommends parallelizing independent work, and documents
React `cache()` for deduplicating non-`fetch` work during a server render. The
same guidance treats authorization as a DAL concern close to the data source.

Consequently:

- Server Components continue to call server-only DAL/read-model functions
  directly; they do not call the application's own Route Handlers.
- `requireRequestContext()` and the underlying `verifyActor()` remain
  request/render scoped through React `cache()`.
- Authorization decisions and user-specific query results are never placed in
  `unstable_cache` or another cross-request cache.
- Phase 3 does not enable Cache Components or change the existing shared
  holiday/leave-type cache policy; cache lifetime and invalidation belong to
  Phase 4.

## Current critical paths

The counts below are code-derived static baselines, not production measurements.
They count Supabase operations and exclude browser asset requests. Actor
resolution costs one Auth claims read plus up to two database queries (user,
then employee); React request memoization prevents the layout and page from
repeating that verification during the same render.

### Employee dashboard and leave page

Both pages start four independent reads, await them, and only then call
`getGrantDrivenOverview()`. The overview first loads configured grant-driven
types, then executes three queries per matched type. With the ten configured
types, that is 31 overview queries and up to 35 application-data queries on a
cold shared-cache request. The per-type queries are parallel within the second
wave, so this is high query fan-out rather than a 31-step serial waterfall.

Target: load all matched type IDs once, then issue one grants query for approved
rows, one leave-request query for used rows, and one grants query for pending
rows, grouping totals by `leave_type_id` in server memory. This changes the
overview from `1 + 3N` queries to four bounded queries and starts it alongside
the page's other independent reads.

### Approvals page

The manager path separately loads direct reports for authorization scope and
again for the proposal dialog. Leave-request hydration and grant hydration are
also executed as consecutive branches even though they are independent after
the actor is known. Depending on role and returned rows, the current page uses
approximately 8–11 application-data queries with several dependent waves.

Target: a server-only approvals read model that:

1. loads a manager's direct reports and their roles once;
2. derives both authorized employee IDs and dialog rows from that result;
3. starts the leave-request branch, grant branch, and dialog/admin-employee
   branch in parallel where their inputs are independent;
4. retains the current pre-query manager scope on leave requests;
5. batches employee, user, and leave-type hydration by unique ID; and
6. throws database errors instead of silently treating failed hydration as
   empty data.

No optimization may load an out-of-scope manager request into process memory.

### Calendar page

Calendar already uses one approved-request query followed by parallel employee,
leave-type, and holiday reads. Its dependency shape is appropriate because the
hydration IDs are not known until the first query completes.

Target: preserve the query shape, add consistent error propagation, and extract
the read model only if doing so improves testability without adding an
abstraction used by a single trivial call.

## Target architecture

```text
Dashboard/Leave/Approvals Server Component
                |
                v
      server-only page read model
                |
                v
    verified request context (Actor + DB)
                |
                v
       batched Supabase queries

Dashboard layout ------> request-scoped verifyActor()
Page read model --------> same request-scoped verifyActor()
```

Pages render returned view models and keep UI-specific formatting. Read-model
functions own query selection, batching, hydration, database error handling,
and role/resource scope. Shared business calculations remain in focused
server-only modules.

## Detailed design

### Batched grant overview

Replace per-type availability calls inside the overview with a batched query
path. Each row query includes `leave_type_id` and `days`; the server groups rows
by type and returns the existing `GrantDrivenOverviewEntry[]` contract. Date,
employee, status, and allowed-type filters remain in the database query.

`getGrantDrivenAvailability()` may remain for a single-type mutation check if
it has a real caller. It must not be implemented by fetching organization-wide
data or by trusting a client-provided employee/type scope.

### Approvals read model

Create a server-only function that accepts the verified request context, checks
`canViewApprovals`, and returns exactly the props required by the four existing
approval/grant components. Manager scope is computed before the pending leave
request query. Admin and manager branches share transformation helpers but keep
their different authorization predicates explicit.

The page remains a Server Component. A loading state, if later needed, should
use `loading.tsx` or Suspense rather than converting the page to a Client
Component; streaming changes are Phase 4.

### Parallel orchestration

Start independent promises before awaiting them. Do not parallelize a query
whose filter depends on IDs or an authorization result from another query.
Examples:

- page balances, requests, holidays, and grant overview can start together;
- manager scope must finish before scoped leave requests start;
- leave-request employees/types can start together after request IDs exist;
- users must follow employee hydration because user IDs come from employees;
- approval leave-request and grant branches can run concurrently once manager
  scope is known.

### Request-scoped deduplication

Keep React `cache()` around authentication/request-context access. Add it to a
data accessor only when the same argument-stable accessor is demonstrably
called more than once during one render. Do not use it as a general query cache,
and do not memoize authorization across requests or users.

## Security invariants

- Every read starts from a verified Actor.
- The service-role client remains server-only and is created only after actor
  verification for application requests.
- Manager leave requests are filtered to authorized direct reports in the
  database query, before rows enter application memory.
- Admin-only organization-wide reads remain explicitly role-gated.
- Returned view models contain only fields required by the current components.
- Query reduction never replaces resource authorization with client-side
  filtering.
- Database failures propagate as infrastructure failures; they are not reported
  as empty data, validation failures, or not-found results.

## Measurement and tests

Each task follows test-driven development and has one commit. Tests use a
recording/fake Supabase client or focused pure-query helpers to assert terminal
operation count, filters, authorization ordering, and returned view models.

Before/after evidence:

- record static query waves for employee dashboard, leave, manager approvals,
  admin approvals, and calendar;
- assert grant overview uses four queries regardless of configured type count;
- assert manager direct reports are loaded once and reused;
- assert the scoped leave-request query never runs with organization-wide scope
  for a manager;
- assert independent branches overlap rather than await serially;
- run the full unit/contract suite, TypeScript, focused ESLint, and a Next.js
  16.3 production webpack build;
- when an approved migrated environment is available, compare production-mode
  query counts and request timings. Otherwise label latency conclusions as
  static-analysis findings.

## Task and commit boundaries

1. **Batch grant overview queries** — tests, batched implementation, and page
   parallelization for dashboard/leave; one commit.
2. **Deduplicate approvals reads** — tests, server-only approvals read model,
   manager-scope reuse, and parallel branch orchestration; one commit.
3. **Verify remaining page paths** — calendar error handling where needed,
   query-count regression coverage, documentation, production build, and final
   measurements; one commit.

The phase is delivered as one PR. Review fixes may use separate focused commits
when preserving review history is clearer than rewriting task commits.

## Non-goals

- Applying or repairing database migrations
- Changing authentication, session cookies, or the role matrix
- New Route Handlers or client-side data-fetching libraries
- Cache Components, new `unstable_cache` entries, or cache-tag redesign
- Streaming/loading-boundary changes
- Mutation redesign or database transactions
- UI redesign

## Rollback

Phase 3 has no database migration and no external-state change. Rollback is an
application-code revert to the existing page-local query orchestration. Phase 2
authentication and identity mapping remain in place.
