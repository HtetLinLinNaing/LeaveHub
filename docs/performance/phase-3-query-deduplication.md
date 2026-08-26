# Phase 3 query-deduplication evidence

## Environment

- Next.js: 16.3.0
- React: 19.2.8
- Measurement status: code-derived static counts unless a migrated approved Supabase target was available

## Query-path comparison

| Path | Before | After | Main change |
| --- | ---: | ---: | --- |
| Employee dashboard, cold holiday cache | up to 35 queries / 3 data waves | at least 8 queries / 2+ data waves | Batch and safely page overview reads; start them with page reads |
| Leave page, cold shared caches | up to 35 queries / 3 data waves | at least 8 queries / 2+ data waves | Batch and safely page overview reads; start them with page reads |
| Manager approvals, populated branches | 10 queries / 9 data waves | 9 queries / 5 data waves | Reuse manager scope and overlap independent branches |
| Admin approvals, populated branches | 8 queries / 7 data waves | 8 queries / 3 data waves | Overlap independent branches |
| Calendar | up to 4 queries / 2 data waves | up to 4 queries / 2 data waves | Preserve shape; propagate failures |

Actor verification remains one Auth claims read plus up to two actor database reads per render. It is request-scoped and is not cached across users.

### Dependency-wave trace

- Employee dashboard, before: wave 1 starts balances, pending count, recent requests, and the cold holiday-cache database read; wave 2 loads configured grant-driven types; wave 3 starts the three per-type amount queries for each of the ten configured types. That is `4 + 1 + (3 * 10) = 35` queries. After: wave 1 starts those four page reads and the overview type query together; wave 2 starts the first page of each batched amount stream. This is a minimum of `4 + 1 + 3 = 8` queries when configured grant-driven types exist. Any full 1,000-row amount page causes that stream to request another page in a later wave.
- Leave page, before: wave 1 starts leave types, balances, requests, and holidays on cold shared caches; wave 2 loads configured grant-driven types; wave 3 starts the three per-type amount queries for each of ten types. After: the same four page reads and the overview type query start in wave 1, followed by the first pages of the three batched amount streams in wave 2. The corresponding cold-cache totals are 35 before and at least 8 after; additional 1,000-row pages add requests and dependent waves.
- Manager approvals, before: manager employees, manager roles, pending requests, request employees/types, request users, manager grant types, manager grant rows, manager grant employees, and dialog employees form nine dependency waves and ten queries. After: manager employees and manager roles remain sequential (waves 1–2); scoped pending requests and manager grant types overlap (wave 3); request employees/types and grant rows overlap (wave 4); request users and grant employees overlap (wave 5). The manager-scope read supplies the dialog rows, leaving nine queries.
- Admin approvals, before: pending requests, request employees/types, request users, grant types, grant rows, grant employees, and active dialog employees form seven waves and eight queries. After: pending requests, grant types, and active dialog employees overlap in wave 1; request employees/types and grant rows overlap in wave 2; request users and grant employees overlap in wave 3. The query total remains eight.
- Calendar, before and after: approved leave requests are wave 1. The holiday read and the employee and leave-type hydrations, when IDs exist, are wave 2. The maximum remains four queries. The page now throws the original failure from the approved-request query and from each uncached hydration query before reading their data.

### Cache interpretation

The holiday and leave-type helpers retain their pre-existing `unstable_cache` keys, tags, and lifetimes; their source readers now throw database errors so a failure cannot be cached as an empty array. The first two table rows deliberately model cold shared caches, so each applicable helper performs one database read. On a cache hit, that helper contributes no database query: subtract one for a dashboard holiday hit, and subtract one for each leave-page leave-type or holiday hit. Cache hits may still be awaited as dependencies, but they are not counted as Supabase database queries.

### Grant overview pagination

Supabase projects return at most 1,000 rows by default unless that server setting is changed. The overview therefore orders every amount stream by primary key and reads inclusive ranges of 1,000 rows until a short page is returned. For configured grant-driven types, its HTTP request count is `1 + approvedPages + usedPages + pendingPages`, not a fixed four. Each amount stream performs at least one request; an exact full page also requires a following request to prove the stream is exhausted. If no configured type exists, the overview stops after the type request.

The application still groups totals in server memory and preserves all database filters on every page: employee ID, batched leave-type IDs, status, approved-grant year, and approved-request year. Pending grants remain intentionally unbounded by year. Pagination changes request count and dependency-wave count, but it prevents complete totals from being replaced by silently truncated aggregates.

## Verification

```text
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts -g "calendar|server-only|self-fetch"
RED: exit 1; 1 failed, 2 passed (985ms). The expected failure was the missing
"if (rawLeaveError) throw rawLeaveError" calendar error contract.

The same focused command after implementation: exit 0; 3 passed (471ms).

npx playwright test --config=playwright.unit.config.ts
exit 0; 96 passed (3.7s).

npx tsc --noEmit
exit 0; no diagnostics.

npx eslint lib/grants.ts lib/grant-overview-supabase.ts lib/cache.ts lib/cache-reader.ts lib/dal/approvals.ts lib/approvals-supabase-queries.ts 'app/(dashboard)/page.tsx' 'app/(dashboard)/leave/page.tsx' 'app/(dashboard)/employees/page.tsx' 'app/(dashboard)/approvals/page.tsx' 'app/(dashboard)/calendar/page.tsx' tests/phase3-query-dedup.spec.ts tests/helpers/recording-supabase.ts playwright.unit.config.ts
exit 0; no diagnostics.

npm run build -- --webpack
exit 0; Next.js 16.3.0 webpack production build compiled successfully in 5.7s,
completed TypeScript in 6.2s, and generated all 10 static pages.

git diff --check 0cb4ba0
exit 0; no whitespace errors.

npm run lint
exit 1 only because of unchanged files outside this task:
- components/features/employees/employee-dialog.tsx:16:11 — existing unused `Props` warning.
- components/features/grants/my-grants-list.tsx:121:49 — existing react/no-unescaped-entities apostrophe error.
No changed-file lint diagnostics occurred; focused ESLint passed.
```

## Production-request measurement

Blocked: no approved migrated measurement target. `.env.local` is absent, and
`DEMO_AUTH_PASSWORD`, the Supabase URL, and the service-role key are unavailable.
No production browser suite, request timing, or live query measurement was run.
All query and wave conclusions in this document are static source-derived counts,
not latency claims.
