# LeaveHub Product Requirements Document (PRD)

## 1. Product Overview

## Product Name

**LeaveHub**

## Product Type

Leave Management System for small organizations.

## Target Users

Small software company with approximately 10 employees.

## Purpose

LeaveHub helps employees request leave, allows managers to approve their direct reports' leave requests, and enables admin to manage employees, leave policies, and company holidays.

The system replaces manual leave tracking through spreadsheets or messages with a centralized application.

---

# 2. Product Vision

Create a simple, reliable, and scalable leave management platform that provides:

- Easy leave requests for employees
- Clear approval workflows for managers
- Centralized leave policy management for admin
- A foundation that can integrate with future systems such as PayHub

---

# 3. Goals

## Business Goals

- Reduce manual leave tracking
- Improve visibility of employee availability
- Prevent leave balance calculation mistakes
- Provide a clear approval process

## Technical Goals

- Build a production-quality full-stack application
- Demonstrate authentication, authorization, database design, and workflow management
- Create a scalable foundation for future payroll features

---

# 4. Users and Roles

## Role Overview

| Role     | Description                          |
| -------- | ------------------------------------ |
| Employee | Requests and manages personal leave  |
| Manager  | Approves direct reports' leave requests |
| Admin    | Approves any leave request and manages employees, policies, and holidays |

---

# 5. Role Permissions

## Employee

Permissions:

- Login
- View personal profile
- View leave balance
- Submit leave request
- Edit pending requests
- Cancel requests
- View leave history
- View team calendar

---

## Manager

Manager inherits Employee permissions.

Additional permissions:

- View team leave requests
- Approve leave requests from direct reports
- Reject leave requests from direct reports
- View team leave calendar

A manager cannot approve their own leave request. A manager cannot approve another manager's leave request. Those requests are handled by Admin.

---

## Admin

Admin inherits Manager permissions.

Additional permissions:

- Create employees
- Import employees from Excel
- Disable employee accounts
- Reset passwords
- Manage leave policies
- Configure public holidays
- Manage employee information
- Approve any leave request, including manager self-requests

Admins do not submit leave requests and have no leave balance.

---

# 6. Authentication

## Authentication Method

Supabase Authentication.

Supported:

- Google OAuth Login

## Access Control Rule

Only registered employees can access the system.

Example:

Employee table:

```
alice@gmail.com
bob@gmail.com
```

Allowed:

```
alice@gmail.com → Login
```

Not allowed:

```
random@gmail.com → Access denied
```

---

# 7. Leave Types

LeaveHub supports:

| Leave Type          | Annual Allocation | Approval                                 |
| ------------------- | ----------------- | ---------------------------------------- |
| Annual Leave        | 14 days           | Manager (Admin for manager self-requests) |
| Medical Leave       | 7 days            | Manager (Admin for manager self-requests) |
| Compassionate Leave | Manual request    | Manager (Admin for manager self-requests) |

---

# 8. Leave Request

Employees can submit:

Required fields:

- Leave Type
- Start Date
- End Date
- Full Day / Half Day
- Reason

Rules:

- Weekends are not counted
- Public holidays are not counted
- Pending requests can be edited
- Approved requests can be cancelled

---

# 9. Leave Approval Workflow

All leave types follow the same flow:

```
Employee / Manager
        ↓
Direct Manager (only if requester is not a manager)
        ↓
Admin (handles manager self-requests and any request not handled by a manager)
        ↓
Approved / Rejected
```

- Annual Leave: routed to the requester's direct manager. Manager self-requests go to Admin.
- Medical Leave: routed to the requester's direct manager. Manager self-requests go to Admin.
- Compassionate Leave: routed to the requester's direct manager. Manager self-requests go to Admin.

---

# 10. Leave Balance Management

## Automatic Calculation

After approval:

```
Remaining Leave =
Available Leave - Approved Leave Days
```

Example:

```
Annual Leave

Available:
14 days

Used:
5 days

Remaining:
9 days
```

---

# 11. Carry Forward Policy

Unused annual leave can carry forward.

Admin controls the maximum carry-forward amount.

Example:

```
Remaining Leave:
10 days

Admin Limit:
6 days

Next Year:

New Leave:
14 days

Carry Forward:
6 days

Total:
20 days
```

Extra unused days expire.

---

# 12. Public Holidays

Admin manages holidays manually.

Example:

```
Holiday Name:
New Year

Date:
01/01/2027
```

Rules:

Public holidays:

- Do not reduce leave balance
- Do not count as leave days

---

# 13. Dashboard Requirements

## Employee Dashboard

Display:

- Remaining leave balance
- Pending requests
- Recent requests
- Upcoming holidays
- Employees away today

---

## Manager Dashboard

Display:

- Pending approvals
- Team leave calendar
- Team leave information

---

## Admin Dashboard

Display:

- Pending approvals count (across the company)
- Approved requests this month
- Employees currently on leave
- Upcoming holidays

---

# 14. Calendar

Calendar displays:

- Public holidays
- Weekends
- Employee leave availability

---

# 15. Future Features

Not included in v1:

- File attachments
- Medical certificates
- Email notifications
- Advanced reports
- Audit logs
- Payroll integration

---

# 16. Future PayHub Integration

LeaveHub should share:

- Employee information
- Authentication
- User roles

Future PayHub can use approved leave data for:

- Salary adjustment
- Payroll calculation
- Attendance management

---

# 17. Technology Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query

## Backend

- Supabase

## Database

- PostgreSQL

## Authentication

- Supabase Auth
- Google OAuth

## Deployment

- Vercel

## Testing

Frontend:

- Playwright

Backend:

- xUnit (future backend services)

---

# 18. Database Entities

## Users

Stores authentication information.

Fields:

```
id
email
role
created_at
```

---

## Employees

Fields:

```
id
user_id
employee_code
first_name
last_name
department
manager_id
join_date
status
```

---

## Leave Types

Fields:

```
id
name
annual_days
requires_approval
allow_half_day
```

---

## Leave Balances

Fields:

```
id
employee_id
leave_type_id
year
allocated_days
used_days
remaining_days
carry_forward_days
```

---

## Leave Requests

Fields:

```
id
employee_id
leave_type_id
start_date
end_date
days
duration_type
reason
status
approved_by
approved_at
created_at
```

---

## Holidays

Fields:

```
id
name
date
```

---

# 19. Non Functional Requirements

## Security

- Role-based access control
- Protected database access
- Secure authentication
- Employee data protection

## Performance

System should support:

- 10 employees initially
- Future growth to hundreds of employees

## Usability

- Responsive design
- Clean UI
- Dark mode support
- Good accessibility practices

---

# 20. Development Phases

## Phase 1: Foundation

- Project setup
- Supabase setup
- Authentication
- Database design

## Phase 2: Employee Management

- Employee CRUD
- Role management

## Phase 3: Leave System

- Leave types
- Leave balance
- Leave requests

## Phase 4: Approval Workflow

- Manager approval (direct reports)
- Admin approval (manager self-requests and any unhandled request)

## Phase 5: Dashboard

- Employee dashboard
- Manager dashboard
- Admin dashboard

## Phase 6: Testing and Deployment

- Playwright tests
- Production deployment

---

# Success Criteria

LeaveHub is successful when:

- Employees can request leave digitally
- Managers can approve direct reports' requests
- Admin can approve any request (including manager self-requests) and manage employees and policies
- Leave balances calculate correctly
- The system can support future PayHub integration

```

```
