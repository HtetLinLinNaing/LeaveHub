# LeaveHub

Leave management system for small teams. Employees request leave, admin approves all requests and manages employees, policies, and holidays.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, RLS)
- **Testing:** Playwright

## Features

- **Leave Requests** — Submit, edit, cancel. Half-day support. Working days auto-calculated (excludes weekends + holidays).
- **Approval Workflow** — Manager approves annual/medical leave for their direct reports. Manager self-requests and any other unhandled requests route to admin.
- **Leave Balances** — Auto-deducted on approval. Carry-forward support.
- **Employee Management** — Admin creates employees, assigns roles/managers, auto-allocates leave balances.
- **Policies** — Edit leave type allocations. Manage public holidays.
- **Team Calendar** — Monthly view with holidays and approved leave.
- **Role-Based Access** — Employee, Manager, Admin. Sidebar nav adapts per role. Admin has no leave balance and cannot request leave.

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project

### Setup

1. Clone and install:

```bash
git clone <repo-url>
cd LeaveHub-V2
npm install
```

2. Copy `.env.local.example` to `.env.local` and add your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. Run migrations in Supabase SQL Editor:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_seed_data.sql`

4. Start dev server:

```bash
npm run dev
```

5. Login with seed accounts:
   - `bob@company.com` — Manager
   - `charlie@company.com` — Employee
   - `diana@company.com` — Employee
   - `eve@company.com` — Admin

### Supabase Migrations

Run in order via SQL Editor:

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Tables, indexes, functions, dev RLS policies |
| `002_seed_data.sql` | Sample users, employees, leave balances, holidays |
| `003_add_auth_fk.sql` | Link users to Supabase Auth (when switching to Google OAuth) |
| `004_strict_rls.sql` | Production RLS policies (when switching to Google OAuth) |

## Project Structure

```
app/
├── (auth)/login/          # Login page
├── (dashboard)/           # Protected routes
│   ├── page.tsx           # Dashboard (role-aware)
│   ├── leave/             # Leave requests
│   ├── approvals/         # Manager approval queue
│   ├── employees/         # Admin: employee management
│   ├── policies/          # Admin: leave types + holidays
│   └── calendar/          # Team calendar
├── api/auth/mock-login/   # Mock auth endpoint
components/
├── ui/                    # shadcn/ui components
├── features/              # Feature components
│   ├── leave/             # Leave request dialog + list
│   ├── approvals/         # Approval list + actions
│   ├── employees/         # Employee list + dialog
│   ├── policies/          # Leave types + holiday management
│   └── calendar/          # Team calendar grid
├── shared/                # Sidebar, shared layouts
lib/
├── supabase/              # Supabase client (server + browser)
├── auth.ts                # Mock auth utilities
├── types.ts               # TypeScript types
├── validations.ts         # Zod schemas
└── constants.ts           # Roles, status colors
supabase/migrations/       # SQL migration files
```

## Auth

Currently using mock auth (cookie-based session). To switch to Google OAuth:

1. Configure Google provider in Supabase Dashboard > Authentication > Providers
2. Run `003_add_auth_fk.sql` to add FK constraint
3. Run `004_strict_rls.sql` to enable production RLS policies
4. Replace mock auth with Supabase Auth in `lib/auth.ts`

## Deployment

Deploy to Vercel:

```bash
npx vercel
```

Set environment variables in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## License

Private — internal use only.
