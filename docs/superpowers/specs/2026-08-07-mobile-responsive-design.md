# Mobile Responsive Design

**Date:** 2026-08-07
**Status:** Draft (pending user review)
**Scope:** All `(dashboard)` routes + login

## Problem

LeaveHub was built desktop-first. At phone widths (≤640px) the persistent `w-64` sidebar consumes the entire viewport, content overflows horizontally on tables, and dialogs feel cramped. The app must work at phone (≥375px) and tablet (≥640px) widths while preserving today's desktop layout.

## Goals

- Dashboard fully usable on phone (≥375px) and tablet (≥640px)
- Desktop layout unchanged at ≥768px
- Zero new runtime dependencies
- Reuse shadcn `base-nova` styling; no custom design system
- Mobile UX patterns: off-canvas drawer, bottom-sheet dialog, stacked card view for tables

## Non-Goals

- Real device testing (Playwright emulated viewports only)
- Native app or PWA shell
- Accessibility audit (separate pass)
- Performance budget enforcement

## Architecture

**One mobile boundary at `<md` (Tailwind = 768px).** Below this, the app is in "phone" mode. At or above, the existing desktop/tablet layout is preserved.

Breakpoints used:

- `sm` (640px) — table → stacked cards
- `md` (768px) — drawer → persistent sidebar

No custom breakpoint values. Tailwind defaults only.

### Component tree (after change)

```
app/(dashboard)/layout.tsx              [server]
  └─ <SidebarProvider>                  [client]
       ├─ <MobileTopBar />              [client, md:hidden]
       ├─ <Sidebar>                     [client]
       │    └─ <SidebarContent>         [shared]
       │  (on <md: wrapped in <Sheet>)
       │  (on ≥md: persistent <aside>)
       └─ <main>{children}</main>

children (page.tsx files)
  └─ <ResponsiveTable>                  [client, sm:hidden cards / hidden sm:table]
       OR existing markup (Dashboard, Calendar)

Dialog usage
  └─ <DialogContent>                    [patched, bottom-sheet on <sm]
```

### New files

| Path | Purpose |
|---|---|
| `components/ui/sheet.tsx` | shadcn Sheet primitive on top of `@base-ui/react` Dialog |
| `components/shared/sidebar-context.tsx` | `SidebarProvider` + `useSidebar` hook |
| `components/shared/mobile-top-bar.tsx` | Sticky top bar with hamburger (md:hidden) |
| `components/shared/responsive-table.tsx` | Generic `<table>` on `≥sm`, card list on `<sm` |
| `tests/mobile-responsive.spec.ts` | New Playwright tests for drawer, card view, bottom-sheet, no-h-scroll |

### Modified files

| Path | Change |
|---|---|
| `components/shared/sidebar.tsx` | Split into `Sidebar` (route-aware wrapper) + `SidebarContent` (existing markup). Wrap content in `<Sheet>` on `<md`. |
| `components/ui/dialog.tsx` | Patch `DialogContent` for bottom-sheet on `<sm` |
| `app/(dashboard)/layout.tsx` | Wrap in `SidebarProvider`; main padding `p-4 sm:p-6`; render `<MobileTopBar />` |
| `app/(dashboard)/employees/page.tsx` | Switch `<table>` to `<ResponsiveTable>` |
| `app/(dashboard)/leave/page.tsx` | Switch list to `<ResponsiveTable>` (verify if already a list) |
| `app/(dashboard)/approvals/page.tsx` | Switch list to `<ResponsiveTable>` |
| `app/(dashboard)/policies/page.tsx` | Switch `holiday-list` + `leave-type-list` to `<ResponsiveTable>` |
| `playwright.config.ts` | Add 3 viewport projects |

## Component Specs

### `SidebarContext` (`components/shared/sidebar-context.tsx`)

```ts
type Ctx = { open: () => void; close: () => void; isOpen: boolean }
export function SidebarProvider({ children }: { children: ReactNode }): JSX.Element
export function useSidebar(): Ctx  // throws if used outside provider
```

- `isOpen` starts `false`
- `open`/`close` are no-ops on `≥md` (safe to call from any caller)
- `Sidebar` listens to `pathname`; effect `close()` on change to dismiss drawer after navigation

### `Sidebar` (refactored)

- Renders `<Sheet>` branch (left side, `w-64 p-0`) when `<md`, `<aside className="hidden md:flex w-64 ...">` when `≥md`
- Both branches share `<SidebarContent>` (existing markup extracted verbatim)
- `Link` `onClick` calls `close()` so nav dismisses the drawer

### `MobileTopBar` (`components/shared/mobile-top-bar.tsx`)

- `<div className="md:hidden sticky top-0 z-30 bg-white border-b h-14 flex items-center px-4 gap-3">`
- Contents: `<Button variant="ghost" size="icon" onClick={open}><Menu /></Button>` + `<span className="font-bold">LeaveHub</span>`
- `z-30` below Sheet overlay (`z-50`) but above main content scroll

### `Sheet` (`components/ui/sheet.tsx`)

API:

```ts
function Sheet(props: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode }): JSX.Element
function SheetTrigger(props: { asChild?: boolean; children: ReactNode }): JSX.Element
function SheetContent(props: {
  side?: "left" | "right" | "top" | "bottom"  // default "right"
  className?: string
  children: ReactNode
}): JSX.Element
function SheetHeader(props: { children: ReactNode; className?: string }): JSX.Element
function SheetTitle(props: { children: ReactNode }): JSX.Element
function SheetClose(props: { asChild?: boolean; children: ReactNode }): JSX.Element
```

- Built on `@base-ui/react` `Dialog` (already in deps) — uses `Dialog.Portal` + `Dialog.Backdrop` + `Dialog.Popup`
- Slide animation via Tailwind classes on `data-state`:
  - left: `data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full`
  - right: mirror
  - top/bottom: `translate-y-±full`
- Backdrop: `data-[state=open]:animate-in data-[state=closed]:animate-out fade-0`
- Focus trap inherited from base-ui Dialog
- Body scroll lock inherited

### `ResponsiveTable<T>` (`components/shared/responsive-table.tsx`)

```ts
type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  className?: string
  mobileHide?: boolean
}
type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T) => string
  mobileCard: (row: T) => ReactNode
  empty?: ReactNode
}
```

- `<table className="hidden sm:table w-full">` with `thead` + `tbody` when `rows.length > 0`
- `<div className="sm:hidden divide-y">{rows.map(r => <div key={keyOf(r)} className="p-4">{mobileCard(r)}</div>)}</div>` when `rows.length > 0`
- `empty` shown in both branches when `rows.length === 0`
- Each list page passes an inline `mobileCard` (no shared abstraction across pages yet)

### `Dialog` (patched)

- Add to `DialogContent` classes:
  - `inset-x-0 bottom-0 sm:inset-auto sm:bottom-auto`
  - `sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2`
  - `max-sm:rounded-t-xl max-sm:rounded-b-none max-sm:max-h-[90vh] max-sm:overflow-y-auto`
  - `pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6`
- Existing centering, max-width, focus trap, scroll lock unchanged
- No new component — patch only existing shadcn wrapper

## Data Flow

- All state lives in `SidebarContext` (client). Pages remain server components when possible
- Pages that need `ResponsiveTable` declare it client-side via a `"use client"` boundary at the list component level (existing list components are already `"use client"`)
- No data fetching changes; responsive is purely presentational

## Error States

- `ResponsiveTable` empty: `empty ?? <p className="text-sm text-gray-500 p-4">No items</p>` in both branches
- Dialog errors: existing inline error rendering unchanged. Mobile bottom-sheet scrolls so user reaches errors
- Sidebar nav: no async; no loading state
- Sheet: backdrop click closes drawer (base-ui default)

## Edge Cases

- Resize across `md` while drawer open: `isOpen` stays `true` but `<Sheet>` is unmounted by `md:hidden` CSS. Resize back to phone → drawer re-opens. Intentional
- Rapid open/close: base-ui Dialog handles portal cleanup
- `ResponsiveTable` with 0 rows: no table, no card list, `empty` rendered
- Safe-area-inset for iOS notch on dialog bottom-sheet

## Testing

### Playwright viewport matrix

`playwright.config.ts` — 3 projects:

```ts
projects: [
  { name: 'mobile',  use: { ...devices['Pixel 7'] } },              // 412x915
  { name: 'tablet',  use: { ...devices['iPad Mini'] } },             // 768x1024
  { name: 'desktop', use: { ...devices['Desktop Chrome'] } }         // 1280x720
]
```

Existing E2E tests re-run at all 3 viewports by default. No per-test annotation needed unless a test assumes width.

### New tests (`tests/mobile-responsive.spec.ts`)

| Test | Viewport | Asserts |
|---|---|---|
| `drawer opens and closes on phone` | mobile (412) | hamburger visible; sidebar `<aside>` hidden; click hamburger → Sheet portal with nav links; click link → drawer closes, page changes |
| `table renders as cards on phone` | mobile (412) at `/employees` | no `<table>` in viewport; each row rendered as card with name/email/role |
| `table renders as table on tablet+` | tablet (768) at `/employees` | `<table>` visible; no card list |
| `dialog is bottom-sheet on phone` | mobile (412) | open leave-request dialog; `DialogContent` has `inset-x-0 bottom-0` (or class string contains it) |
| `no horizontal scroll on phone` | mobile (412) on each dashboard route | `document.documentElement.scrollWidth <= window.innerWidth` |
| `top bar sticky on scroll` | mobile (412) | scroll `<main>`; top bar still at `top: 0` |

### Self-check (dev only)

- `npm run dev` at 375px viewport: visually confirm drawer open, card view on `/employees`, bottom-sheet on leave-request dialog
- Run as a one-shot before declaring done; not committed as a test

### Out of scope for this pass

- Real device lab
- Performance budget
- Accessibility audit (focus trap inherited from base-ui; a separate `a11y` pass covers keyboard nav, screen reader labels, contrast)
- Animated page transitions

## Migration / Rollout

- All changes behind existing routes; no flag/toggle needed
- Rollback: `git revert <commit>` reverts responsive pass entirely; desktop layout was unchanged
- New components have no consumers outside this pass until future pages use them

## Open Questions

None at design time. Resolved during brainstorming:
- Target: phone + tablet (≥640px)
- Sidebar: off-canvas drawer on phone, persistent on tablet+
- Tables: card view on phone, table on tablet+
- Dialogs: bottom-sheet on phone, centered modal on tablet+
- Testing: Playwright viewport matrix
