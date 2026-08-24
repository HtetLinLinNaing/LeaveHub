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

2. Copy `.env.local.example` to `.env.local` and add your Supabase credentials.
   Keep the service-role key server-only:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOW_DEMO_AUTH_BOOTSTRAP=false
DEMO_AUTH_PASSWORD=replace-with-at-least-12-characters
```

3. Apply all migrations from `001` through `009` in filename order. Read the
   [migration deployment guide](supabase/migrations/README.md) before applying
   `009`; migration and bootstrap work must target an approved local/disposable
   project.

4. Bootstrap the demo Auth identities once. Set
   `ALLOW_DEMO_AUTH_BOOTSTRAP=true`, run the command, review its counts, then
   immediately set the flag back to `false` or remove it:

```bash
npm run auth:bootstrap-demo
```

5. Start the dev server:

```bash
npm run dev
```

6. Login with the configured `DEMO_AUTH_PASSWORD` and a seed account:
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
| `003_add_auth_fk.sql` | Initial Auth identity constraint |
| `004_strict_rls.sql` | Strict role-based RLS policies |
| `005_fix_rls_recursion.sql` | Non-recursive role helpers |
| `006_fix_employees_recursion.sql` | Non-recursive employee helpers |
| `007_compassionate_grants.sql` | Compassionate leave grants |
| `008_mixed_durations_emergency_mc.sql` | Mixed durations, emergency contacts, and MC metadata |
| `009_supabase_password_auth.sql` | Durable Auth identity link and removal of remaining anonymous policies |

## Project Structure

```
app/
├── (auth)/login/          # Supabase password login page
├── (dashboard)/           # Protected routes
│   ├── page.tsx           # Dashboard (role-aware)
│   ├── leave/             # Leave requests
│   ├── approvals/         # Manager approval queue
│   ├── employees/         # Admin: employee management
│   ├── policies/          # Admin: leave types + holidays
│   └── calendar/          # Team calendar
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
├── auth/                  # Password login, logout, and verified sessions
├── dal/                   # Server-only actor-scoped data access
├── supabase/              # Supabase clients (server + browser)
├── types.ts               # TypeScript types
├── validations.ts         # Zod schemas
└── constants.ts           # Roles, status colors
supabase/migrations/       # SQL migration files
```

## Auth

LeaveHub uses Supabase email/password authentication with HttpOnly SSR session
cookies. Roles and employee status come from LeaveHub tables through the verified
`auth_user_id` link. Public signup is not enabled; demo accounts are provisioned
only through the explicit administrative bootstrap command.

## Deployment

Follow the backup, preflight, migration `009`, one-time bootstrap, smoke-test, and
rollback procedure in [the migration deployment guide](supabase/migrations/README.md).
In particular, remove `ALLOW_DEMO_AUTH_BOOTSTRAP=true` before deployment. During
an incident rollback, roll back application code first; do not drop the
`auth_user_id` link and never restore anonymous RLS policies.

Deploy the application to Vercel:

```bash
npx vercel
```

Set environment variables in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

`DEMO_AUTH_PASSWORD` and `ALLOW_DEMO_AUTH_BOOTSTRAP=true` belong only in the
controlled one-time bootstrap environment, not normal application runtime.

## License

Private — internal use only.
