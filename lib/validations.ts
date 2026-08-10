import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

// Single duration picker, drives one row in leave_request_days.
export const dayDurationSchema = z.enum([
  "full_day",
  "half_day_morning",
  "half_day_evening",
]);

export type DayDuration = z.infer<typeof dayDurationSchema>;

// Optional emergency contact — all three together or all absent.
export const emergencyContactSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(200),
    phone: z.string().min(1, "Phone is required").max(50),
    relationship: z.string().min(1, "Relationship is required").max(100),
  })
  .optional();

// Optional MC metadata returned from the upload step. The actual file
// is uploaded separately to Supabase Storage; only the reference is
// stored on the leave request.
export const mcMetaSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1).max(255),
  })
  .optional();

// Backwards-compatible duration_type — kept on the parent row so existing
// approval / calendar / dashboard code keeps reading the same shape.
export const leaveRequestSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date: dateString,
  end_date: dateString,
  duration_type: z.enum(["full_day", "half_day"]),
  reason: z.string().min(1, "Reason is required").max(500),
});

// New shape: per-day durations + optional emergency contact + optional MC.
// Existing single-duration callers can still pass a `days` array with one
// element to produce the same result as the old `duration_type` form.
export const leaveRequestDaySchema = z.object({
  date: dateString,
  duration: dayDurationSchema,
});

export const createLeaveRequestSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date: dateString,
  end_date: dateString,
  days: z.array(leaveRequestDaySchema).min(1, "Select at least one day"),
  reason: z.string().min(1, "Reason is required").max(500),
  emergency_contact: emergencyContactSchema,
  mc: mcMetaSchema,
});

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type LeaveRequestDayInput = z.infer<typeof leaveRequestDaySchema>;
export type EmergencyContactInput = NonNullable<
  z.infer<typeof emergencyContactSchema>
>;
export type McMetaInput = NonNullable<z.infer<typeof mcMetaSchema>>;

export const employeeSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email(),
  department: z.string().min(1).max(100),
  manager_id: z.string().uuid().nullable().optional(),
  join_date: dateString,
  role: z.enum(["employee"]),
});

export const holidaySchema = z.object({
  name: z.string().min(1).max(200),
  date: dateString,
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;

export const leaveGrantSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type_name: z.string().min(1, "Leave type is required"),
  days: z.number().int().min(1, "Days must be at least 1").max(365, "Days must be at most 365"),
  reason: z.string().min(1, "Reason is required").max(500, "Reason must be at most 500 characters"),
});

export type LeaveGrantInput = z.infer<typeof leaveGrantSchema>;
