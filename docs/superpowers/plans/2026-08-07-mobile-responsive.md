# Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LeaveHub's dashboard fully usable on phone (≥375px) and tablet (≥640px) while preserving today's desktop layout, with no new runtime dependencies.

**Architecture:** Off-canvas `Sheet` drawer for nav on phone, persistent `aside` on tablet+. `ResponsiveTable<T>` switches between `<table>` (≥sm) and stacked card list (<sm). `Dialog` content becomes a bottom sheet on phone. `MobileTopBar` exposes the drawer via hamburger. All breakpoint-driven via Tailwind defaults (sm=640, md=768).

**Tech Stack:** Next.js 16.3.0 App Router, React 19, Tailwind v4, `@base-ui/react` Dialog, shadcn `base-nova` style, Playwright (3 viewport projects).

**Spec:** `docs/superpowers/specs/2026-08-07-mobile-responsive-design.md`

## Global Constraints

- Phone target: ≥375px; tablet: ≥640px; desktop unchanged at ≥768px
- Breakpoints used: `sm` (640px) for table→cards, `md` (768px) for drawer→aside
- Zero new runtime dependencies — `@base-ui/react` Dialog already in deps
- Reuse shadcn `base-nova` styling; no custom design tokens
- No `matchMedia` / no JS breakpoint detection — Tailwind CSS handles show/hide
- All commits follow Conventional Commits; each task ends with a single commit
- Each task independently testable

---

### Task 1: Add Sheet primitive on top of `@base-ui/react` Dialog

**Files:**
- Create: `components/ui/sheet.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/dialog` (already in deps), `lucide-react` `XIcon`, `cn` from `@/lib/utils`, `Button` from `@/components/ui/button`
- Produces: exports `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetClose` for use in Task 4

- [ ] **Step 1: Write `components/ui/sheet.tsx`**

```tsx
"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type Side = "left" | "right" | "top" | "bottom"

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

const sideClasses: Record<Side, string> = {
  left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
  right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
  top: "inset-x-0 top-0 w-full h-1/3 border-b data-open:animate-in data-open:slide-in-from-top data-closed:animate-out data-closed:slide-out-to-top",
  bottom: "inset-x-0 bottom-0 w-full h-1/3 border-t data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
}

function SheetContent({
  className,
  side = "right",
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: Side
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 gap-4 bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none",
          sideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`tw-animate-css` provides `slide-in-from-*` / `slide-out-to-*` keyframes; if not present, add them to `app/globals.css` per Step 2a.)

- [ ] **Step 2a (if needed): Add slide keyframes to `app/globals.css`**

Insert at the end of the file (after the existing `@layer base` block, before any `@layer` close):

```css
@layer utilities {
  @keyframes slide-in-from-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
  @keyframes slide-out-to-left { from { transform: translateX(0); } to { transform: translateX(-100%); } }
  @keyframes slide-in-from-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes slide-out-to-right { from { transform: translateX(0); } to { transform: translateX(100%); } }
  @keyframes slide-in-from-top { from { transform: translateY(-100%); } to { transform: translateY(0); } }
  @keyframes slide-out-to-top { from { transform: translateY(0); } to { transform: translateY(-100%); } }
  @keyframes slide-in-from-bottom { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes slide-out-to-bottom { from { transform: translateY(0); } to { transform: translateY(100%); } }
  .animate-in { animation: 200ms ease-out forwards; }
  .animate-out { animation: 150ms ease-in forwards; }
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/sheet.tsx app/globals.css
git commit -m "feat(ui): add Sheet primitive on base-ui Dialog"
```

---

### Task 2: Add SidebarProvider context + useSidebar hook

**Files:**
- Create: `components/shared/sidebar-context.tsx`

**Interfaces:**
- Consumes: `React.createContext`, `useContext`, `useState`
- Produces: `SidebarProvider`, `useSidebar()` returning `{ open: () => void; close: () => void; isOpen: boolean }`

- [ ] **Step 1: Write `components/shared/sidebar-context.tsx`**

```tsx
"use client"

import * as React from "react"

type SidebarContextValue = {
  open: () => void
  close: () => void
  isOpen: boolean
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false)

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [isOpen]
  )

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider")
  }
  return ctx
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/shared/sidebar-context.tsx
git commit -m "feat(nav): add SidebarProvider context and useSidebar hook"
```

---

### Task 3: Extract SidebarContent + refactor Sidebar to drawer + persistent

**Files:**
- Modify: `components/shared/sidebar.tsx`

**Interfaces:**
- Consumes: `useSidebar` from Task 2, `Sheet` family from Task 1, existing `navItems` constant
- Produces: `Sidebar` component that renders `<Sheet>` branch on `<md` and persistent `<aside>` on `≥md`, both sharing `SidebarContent`; nav `Link` clicks call `close()` so drawer dismisses

- [ ] **Step 1: Replace `components/shared/sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { clearMockSession, type MockSession } from "@/lib/auth";
import type { Role } from "@/lib/types";
import {
  LayoutDashboard,
  CalendarDays,
  FileText,
  CheckCircle,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSidebar } from "@/components/shared/sidebar-context";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: Role[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["employee", "manager", "hr", "admin"] },
  { label: "My Leave", href: "/leave", icon: FileText, roles: ["employee", "manager", "hr", "admin"] },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, roles: ["employee", "manager", "hr", "admin"] },
  { label: "Approvals", href: "/approvals", icon: CheckCircle, roles: ["manager", "hr", "admin"] },
  { label: "Employees", href: "/employees", icon: Users, roles: ["hr", "admin"] },
  { label: "Policies", href: "/policies", icon: Settings, roles: ["hr", "admin"] },
];

function SidebarContent({ role, email }: { role: Role; email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { close } = useSidebar();

  const filteredItems = navItems.filter((item) => item.roles.includes(role));

  function handleLogout() {
    clearMockSession();
    close();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex h-14 items-center border-b px-4">
        <h1 className="text-lg font-bold">LeaveHub</h1>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {filteredItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 px-3 text-xs text-gray-500">{email}</div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ role, email }: { role: Role; email: string }) {
  const { isOpen, close } = useSidebar();
  const pathname = usePathname();

  // Close drawer on navigation
  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <>
      {/* Mobile: off-canvas drawer */}
      <div className="md:hidden">
        <Sheet open={isOpen} onOpenChange={(v) => (v ? null : close())}>
          <SheetContent
            side="left"
            className="w-64 max-w-full p-0"
            showCloseButton={false}
          >
            <SidebarContent role={role} email={email} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Tablet/Desktop: persistent aside */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-white md:flex">
        <SidebarContent role={role} email={email} />
      </aside>
    </>
  );
}
```

Note: drawer close on `isOpen=false` is handled by base-ui `onOpenChange` calling `close()`; the `useEffect` on `pathname` covers the case where navigation happens before close animation completes.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify dev still works**

Run: `npm run dev` (background). Open `http://localhost:3000/login`, sign in. At desktop width sidebar should be visible as `<aside>`. At mobile width (resize browser < 768px) sidebar should be hidden. **Do not commit if sidebar disappears at desktop width** — that means `hidden md:flex` is overridden.

- [ ] **Step 4: Commit**

```bash
git add components/shared/sidebar.tsx
git commit -m "feat(nav): extract SidebarContent and add mobile drawer"
```

---

### Task 4: Add MobileTopBar

**Files:**
- Create: `components/shared/mobile-top-bar.tsx`

**Interfaces:**
- Consumes: `useSidebar` from Task 2, `lucide-react` `Menu` icon, `Button` from `@/components/ui/button`
- Produces: `MobileTopBar` component (`md:hidden` sticky bar with hamburger)

- [ ] **Step 1: Write `components/shared/mobile-top-bar.tsx`**

```tsx
"use client"

import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/shared/sidebar-context"

export function MobileTopBar() {
  const { open } = useSidebar()

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={open}
        aria-label="Open navigation"
        data-testid="mobile-hamburger"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="font-bold">LeaveHub</span>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/shared/mobile-top-bar.tsx
git commit -m "feat(nav): add MobileTopBar with hamburger"
```

---

### Task 5: Wire SidebarProvider + MobileTopBar into dashboard layout

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `SidebarProvider` from Task 2, `MobileTopBar` from Task 4
- Produces: dashboard layout that wraps children in `SidebarProvider` and renders `MobileTopBar` above `<main>`

- [ ] **Step 1: Replace `app/(dashboard)/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getMockSessionFromCookie, type MockSession } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";
import { SidebarProvider } from "@/components/shared/sidebar-context";
import { MobileTopBar } from "@/components/shared/mobile-top-bar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const session = getMockSessionFromCookie(cookieHeader);

  if (!session) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar role={session.role} email={session.email} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Verify dev at both viewports**

Run: `npm run dev` (background, if not running). Resize browser:
- ≥768px: persistent sidebar visible on left, no top bar
- <768px: sidebar hidden, top bar with hamburger visible, clicking hamburger opens drawer
- Drawer click on a nav link closes drawer and navigates

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/layout.tsx
git commit -m "feat(layout): wire SidebarProvider and MobileTopBar"
```

---

### Task 6: Patch Dialog to bottom-sheet on phone

**Files:**
- Modify: `components/ui/dialog.tsx`

**Interfaces:**
- Consumes: existing `DialogContent` props and classes
- Produces: `DialogContent` that renders centered modal on `≥sm` and full-width bottom sheet on `<sm` with safe-area-inset padding

- [ ] **Step 1: Update the `className` string inside `DialogContent`**

In `components/ui/dialog.tsx`, replace the `cn(...)` call inside `DialogPrimitive.Popup` (currently on lines 53-58). The new `className` value:

```
"fixed z-50 grid w-full gap-4 rounded-t-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-sm sm:rounded-xl data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4"
```

Replace the entire existing `className` argument to `cn(...)` with this new string. All other markup stays the same.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Visually verify**

Run: `npm run dev`. Open leave-request dialog at:
- ≥640px: centered modal, rounded-xl, max-w-sm — same as before
- <640px: spans full width, hugs bottom edge, rounded top only, scrollable

- [ ] **Step 4: Commit**

```bash
git add components/ui/dialog.tsx
git commit -m "feat(ui): make Dialog bottom-sheet on phone"
```

---

### Task 7: Add ResponsiveTable component

**Files:**
- Create: `components/shared/responsive-table.tsx`

**Interfaces:**
- Consumes: `ReactNode`
- Produces: `<ResponsiveTable<T>>` rendering `<table className="hidden sm:table">` + `<div className="sm:hidden divide-y">` of cards, switching based on Tailwind breakpoints

- [ ] **Step 1: Write `components/shared/responsive-table.tsx`**

```tsx
import * as React from "react"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  keyOf: (row: T) => string
  mobileCard: (row: T) => React.ReactNode
  empty?: React.ReactNode
}

export function ResponsiveTable<T>({
  columns,
  rows,
  keyOf,
  mobileCard,
  empty,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <>{empty ?? <div className="rounded-lg border bg-white p-8 text-center text-gray-500">No items</div>}</>
    )
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border bg-white sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-medium ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={keyOf(row)} className="border-b last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-white sm:hidden">
        {rows.map((row) => (
          <div key={keyOf(row)} className="p-4">
            {mobileCard(row)}
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/shared/responsive-table.tsx
git commit -m "feat(table): add ResponsiveTable with card view on phone"
```

---

### Task 8: Migrate EmployeeList to ResponsiveTable

**Files:**
- Modify: `components/features/employees/employee-list.tsx`

**Interfaces:**
- Consumes: `ResponsiveTable` and `Column<T>` from Task 7, `Badge` from `@/components/ui/badge`, `ROLE_LABELS` from `@/lib/constants`
- Produces: `EmployeeList` rendering table on `≥sm`, card list on `<sm` with `mobileCard` showing code / name / email / dept / role badge / status badge

- [ ] **Step 1: Replace `components/features/employees/employee-list.tsx`**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@/lib/types";

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  department: string;
  join_date: string;
  status: string;
  users: { email: string; role: Role } | null;
}

const columns: Column<Employee>[] = [
  { key: "code", header: "Code", cell: (e) => <span className="font-mono text-xs">{e.employee_code}</span> },
  { key: "name", header: "Name", cell: (e) => <span className="font-medium">{e.first_name} {e.last_name}</span> },
  { key: "email", header: "Email", cell: (e) => e.users?.email },
  { key: "department", header: "Department", cell: (e) => e.department },
  { key: "role", header: "Role", cell: (e) => <Badge variant="outline">{ROLE_LABELS[e.users?.role ?? "employee"]}</Badge> },
  { key: "status", header: "Status", cell: (e) => (
    <Badge variant="outline" className={e.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
      {e.status}
    </Badge>
  ) },
];

function MobileEmployeeCard({ employee }: { employee: Employee }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">{employee.first_name} {employee.last_name}</span>
        <span className="font-mono text-xs text-gray-500">{employee.employee_code}</span>
      </div>
      <div className="text-sm text-gray-500">{employee.users?.email}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{employee.department}</span>
        <Badge variant="outline">{ROLE_LABELS[employee.users?.role ?? "employee"]}</Badge>
        <Badge variant="outline" className={employee.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
          {employee.status}
        </Badge>
      </div>
    </div>
  );
}

export function EmployeeList({ employees }: { employees: Employee[] }) {
  return (
    <ResponsiveTable
      columns={columns}
      rows={employees}
      keyOf={(e) => e.id}
      mobileCard={(e) => <MobileEmployeeCard employee={e} />}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No employees found.
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`. Sign in as HR. At `/employees`:
- ≥640px: table renders with 6 columns
- <640px: each employee renders as a card stack
- Empty state: shows "No employees found."

- [ ] **Step 4: Commit**

```bash
git add components/features/employees/employee-list.tsx
git commit -m "feat(employees): use ResponsiveTable for employees list"
```

---

### Task 9: Migrate LeaveRequestList to ResponsiveTable

**Files:**
- Modify: `components/features/leave/leave-request-list.tsx`

**Interfaces:**
- Consumes: `ResponsiveTable`, `Column<T>`, `Badge`, `Button`, `STATUS_COLORS`, `format` from `date-fns`
- Produces: `LeaveRequestList` with mobile card view containing type, date range, days, status badge, cancel button

- [ ] **Step 1: Replace `components/features/leave/leave-request-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";
import type { LeaveRequestStatus } from "@/lib/types";

interface Request {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: LeaveRequestStatus;
  created_at: string;
  leave_types: { name: string } | null;
}

function dateRange(start: string, end: string) {
  if (start === end) return format(new Date(start), "MMM d, yyyy");
  return `${format(new Date(start), "MMM d")} — ${format(new Date(end), "MMM d, yyyy")}`;
}

function StatusBadge({ status }: { status: LeaveRequestStatus }) {
  return (
    <Badge variant="outline" className={STATUS_COLORS[status]}>
      {status}
    </Badge>
  );
}

function CancelButton({ id, onCancel, disabled }: { id: string; onCancel: (id: string) => void; disabled: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => onCancel(id)} disabled={disabled}>
      Cancel
    </Button>
  );
}

export function LeaveRequestList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setCancellingId(id);
    const supabase = createClient();
    await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", id);
    setCancellingId(null);
    router.refresh();
  }

  const columns: Column<Request>[] = [
    { key: "type", header: "Type", cell: (r) => r.leave_types?.name },
    { key: "dates", header: "Dates", cell: (r) => dateRange(r.start_date, r.end_date) },
    { key: "days", header: "Days", cell: (r) => `${r.days}${r.duration_type === "half_day" ? " (½)" : ""}` },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: "Actions", cell: (r) => (r.status === "pending" || r.status === "approved") ? (
      <CancelButton id={r.id} onCancel={handleCancel} disabled={cancellingId === r.id} />
    ) : null },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={requests}
      keyOf={(r) => r.id}
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.leave_types?.name}</span>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-sm text-gray-500">{dateRange(r.start_date, r.end_date)}</div>
          <div className="text-sm text-gray-500">
            {r.days} day{r.days === 1 ? "" : "s"}{r.duration_type === "half_day" ? " (half day)" : ""}
          </div>
          {(r.status === "pending" || r.status === "approved") && (
            <div className="pt-1">
              <CancelButton id={r.id} onCancel={handleCancel} disabled={cancellingId === r.id} />
            </div>
          )}
        </div>
      )}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No leave requests yet. Click &quot;Request Leave&quot; to create one.
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`. Sign in as employee. At `/leave`:
- ≥640px: table with 5 columns
- <640px: cards with type / dates / days / status / cancel button

- [ ] **Step 4: Commit**

```bash
git add components/features/leave/leave-request-list.tsx
git commit -m "feat(leave): use ResponsiveTable for leave requests list"
```

---

### Task 10: Migrate HolidayList to ResponsiveTable

**Files:**
- Modify: `components/features/policies/holiday-list.tsx`

**Interfaces:**
- Consumes: `ResponsiveTable`, `Column<T>`, `Button`, `format` from `date-fns`, `Trash2` from `lucide-react`
- Produces: `HolidayList` with mobile card view (name / date / delete)

- [ ] **Step 1: Replace `components/features/policies/holiday-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import type { Holiday } from "@/lib/types";

export function HolidayList({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    const supabase = createClient();
    await supabase.from("holidays").delete().eq("id", id);
    setDeletingId(null);
    router.refresh();
  }

  const columns: Column<Holiday>[] = [
    { key: "name", header: "Holiday", cell: (h) => h.name },
    { key: "date", header: "Date", cell: (h) => format(new Date(h.date), "MMM d, yyyy") },
    { key: "actions", header: "Actions", cell: (h) => (
      <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={deletingId === h.id}>
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
    ) },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={holidays}
      keyOf={(h) => h.id}
      mobileCard={(h) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">{h.name}</div>
            <div className="text-sm text-gray-500">{format(new Date(h.date), "MMM d, yyyy")}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={deletingId === h.id}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      )}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No holidays configured.
        </div>
      }
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/features/policies/holiday-list.tsx
git commit -m "feat(policies): use ResponsiveTable for holidays list"
```

---

### Task 11: Migrate LeaveTypeList to ResponsiveTable

**Files:**
- Modify: `components/features/policies/leave-type-list.tsx`

**Interfaces:**
- Consumes: `ResponsiveTable`, `Column<T>`, `Button`, `Pencil`, `Save`, `X` from `lucide-react`
- Produces: `LeaveTypeList` with mobile card view (name / days input / half day / edit-save-cancel buttons)

- [ ] **Step 1: Replace `components/features/policies/leave-type-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import type { LeaveType } from "@/lib/types";
import { Pencil, Save, X } from "lucide-react";

export function LeaveTypeList({ leaveTypes }: { leaveTypes: LeaveType[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDays, setEditDays] = useState(0);
  const [saving, setSaving] = useState(false);

  function startEdit(lt: LeaveType) {
    setEditingId(lt.id);
    setEditDays(lt.annual_days);
  }

  async function handleSave(id: string) {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("leave_types")
      .update({ annual_days: editDays })
      .eq("id", id);
    setEditingId(null);
    setSaving(false);
    router.refresh();
  }

  function EditCell({ lt }: { lt: LeaveType }) {
    if (editingId !== lt.id) {
      return (
        <Button size="sm" variant="ghost" onClick={() => startEdit(lt)}>
          <Pencil className="h-4 w-4" />
        </Button>
      );
    }
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => handleSave(lt.id)} disabled={saving}>
          <Save className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const columns: Column<LeaveType>[] = [
    { key: "name", header: "Type", cell: (lt) => <span className="font-medium">{lt.name}</span> },
    { key: "days", header: "Days/Year", cell: (lt) => editingId === lt.id ? (
      <input
        type="number"
        value={editDays}
        onChange={(e) => setEditDays(Number(e.target.value))}
        className="w-20 rounded border px-2 py-1 text-sm"
        min={0}
      />
    ) : lt.annual_days },
    { key: "halfday", header: "Half Day", cell: (lt) => lt.allow_half_day ? "Yes" : "No" },
    { key: "actions", header: "Actions", cell: (lt) => <EditCell lt={lt} /> },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={leaveTypes}
      keyOf={(lt) => lt.id}
      mobileCard={(lt) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{lt.name}</span>
            <EditCell lt={lt} />
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>
              {editingId === lt.id ? (
                <input
                  type="number"
                  value={editDays}
                  onChange={(e) => setEditDays(Number(e.target.value))}
                  className="w-20 rounded border px-2 py-1 text-sm"
                  min={0}
                />
              ) : (
                <span><strong className="text-gray-900">{lt.annual_days}</strong> days/year</span>
              )}
            </span>
            <span>Half day: {lt.allow_half_day ? "Yes" : "No"}</span>
          </div>
        </div>
      )}
    />
  );
}
```

Note: `LeaveTypeList` had no explicit empty branch in the original (it always rendered a `<table>`); `ResponsiveTable` falls back to its default empty message. Verify the spec intent: this is acceptable since `leave_types` is a config table unlikely to be empty.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/features/policies/leave-type-list.tsx
git commit -m "feat(policies): use ResponsiveTable for leave types list"
```

---

### Task 12: Add Playwright viewport matrix

**Files:**
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `@playwright/test` `devices`
- Produces: 3 projects (`mobile`, `tablet`, `desktop`) all sharing existing tests

- [ ] **Step 1: Replace `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["iPad Mini"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
```

- [ ] **Step 2: Run existing tests at desktop only to confirm no regression**

Run: `npx playwright test --project=desktop --reporter=list 2>&1 | tail -30`
Expected: existing tests pass (all 3 viewport projects re-run existing tests but desktop is fastest to verify). If any test fails, fix the test, not the production code.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "test(playwright): add 3-viewport project matrix"
```

---

### Task 13: Add mobile-specific responsive tests

**Files:**
- Create: `tests/mobile-responsive.spec.ts`

**Interfaces:**
- Consumes: `login`, `navigateTo`, `USERS` from `./helpers`
- Produces: 6 tests across phone + tablet viewports covering drawer, card view, bottom-sheet, no horizontal scroll, sticky top bar

- [ ] **Step 1: Write `tests/mobile-responsive.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Mobile responsive", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("drawer opens and closes on phone", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Dashboard");

    // Sidebar aside hidden on phone
    await expect(page.locator("aside.hidden.md\\:flex")).toBeHidden();

    // Hamburger visible
    const hamburger = page.getByTestId("mobile-hamburger");
    await expect(hamburger).toBeVisible();

    // Open drawer
    await hamburger.click();
    const drawerLink = page.locator("[data-slot=sheet-content] >> text=Employees");
    await expect(drawerLink).toBeVisible();

    // Click link navigates and closes drawer
    await drawerLink.click();
    await expect(page).toHaveURL(/\/employees/);
    await expect(page.locator("[data-slot=sheet-content]")).toBeHidden();
  });

  test("employee list renders as cards on phone", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Employees");

    // Table hidden
    await expect(page.locator("table")).toBeHidden();
    // Cards visible (seed data)
    await expect(page.getByText("Alice Nguyen")).toBeVisible();
    await expect(page.getByText("alice@company.com")).toBeVisible();
  });

  test("dialog is bottom-sheet on phone", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");

    const content = page.locator("[data-slot=dialog-content]");
    await expect(content).toBeVisible();
    const classes = await content.getAttribute("class");
    expect(classes).toContain("bottom-0");
    expect(classes).toContain("inset-x-0");
  });

  test("no horizontal scroll on phone on dashboard", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Dashboard");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("no horizontal scroll on employees page on phone", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Employees");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("top bar sticky on scroll", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Employees");
    const bar = page.locator(".md\\:hidden.sticky");
    await expect(bar).toBeVisible();
    await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 400));
    const top = await bar.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
  });
});

test.describe("Tablet responsive", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("employees renders as table on tablet", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Employees");
    await expect(page.locator("table")).toBeVisible();
    await expect(page.getByText("Alice Nguyen")).toBeVisible();
  });

  test("sidebar visible on tablet", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Dashboard");
    await expect(page.locator("aside.hidden.md\\:flex")).toBeVisible();
    await expect(page.getByTestId("mobile-hamburger")).toBeHidden();
  });
});
```

- [ ] **Step 2: Run mobile tests**

Run: `npx playwright test mobile-responsive --project=mobile --reporter=list 2>&1 | tail -40`
Expected: all 6 mobile tests pass. If any fail, fix the production code (not the test).

- [ ] **Step 3: Run tablet tests**

Run: `npx playwright test mobile-responsive --project=tablet --reporter=list 2>&1 | tail -20`
Expected: 2 tablet tests pass.

- [ ] **Step 4: Run all projects on the new test file**

Run: `npx playwright test mobile-responsive --reporter=list 2>&1 | tail -20`
Expected: 6 tests × 3 projects = 18 runs all pass (the desktop viewport will still satisfy the phone+tablet tests because they only check that things render, not at specific width — the `.toBeHidden()` checks for the persistent sidebar at desktop may fail since desktop shows it; if so, restrict mobile tests to mobile project via `test.use` and tablet tests to tablet project, which is already the case). Confirm the suite reports green.

- [ ] **Step 5: Commit**

```bash
git add tests/mobile-responsive.spec.ts
git commit -m "test(mobile): add responsive E2E tests for drawer, cards, bottom-sheet"
```

---

### Task 14: Full suite verification + final commit

**Files:**
- None (verification only)

- [ ] **Step 1: Type-check entire project**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (warnings OK)

- [ ] **Step 3: Run full Playwright suite at desktop**

Run: `npx playwright test --project=desktop --reporter=list 2>&1 | tail -30`
Expected: all existing tests + new mobile-responsive tests pass at desktop width

- [ ] **Step 4: Run full suite at all 3 viewports**

Run: `npx playwright test --reporter=list 2>&1 | tail -30`
Expected: all tests pass at all 3 viewports. This will take ~3x as long as desktop-only.

- [ ] **Step 5: Final visual check**

Run: `npm run dev` and manually verify at 375px viewport: drawer opens, employee list shows cards, leave-request dialog is bottom-sheet. At 1280px: layout unchanged from before this work.

- [ ] **Step 6: If any test fails, fix and amend**

If anything fails, fix the production code in a follow-up commit (do not amend prior commits — keep history clean for review).

---
