import { z } from "zod";

export const leaveRequestSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_type: z.enum(["full_day", "half_day"]),
  reason: z.string().min(1, "Reason is required").max(500),
  for_employee_id: z.string().uuid().optional(),
});

export const employeeSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email(),
  department: z.string().min(1).max(100),
  manager_id: z.string().uuid().nullable().optional(),
  join_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(["employee"]),
});

export const holidaySchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;
