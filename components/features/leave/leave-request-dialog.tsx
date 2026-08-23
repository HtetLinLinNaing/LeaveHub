"use client";

import { useMemo, useState, useTransition } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { createLeaveRequest, uploadMcCertificate } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DayDuration, LeaveType } from "@/lib/types";
import { Plus, X } from "lucide-react";

interface Props {
  leaveTypes: LeaveType[];
  compassionateAvailable: number;
  holidays: { date: string }[];
}

const UNITS: Record<DayDuration, number> = {
  full_day: 1,
  half_day_morning: 0.5,
  half_day_evening: 0.5,
};

function workingDates(
  start: string,
  end: string,
  holidays: Set<string>,
): string[] {
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  let cursor = parseISO(start);
  const last = parseISO(end);
  while (cursor <= last) {
    const dow = cursor.getDay();
    const iso = format(cursor, "yyyy-MM-dd");
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) {
      out.push(iso);
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function LeaveRequestDialog({
  leaveTypes,
  compassionateAvailable,
  holidays,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [mcFile, setMcFile] = useState<File | null>(null);
  const [mcMeta, setMcMeta] = useState<{ path: string; name: string } | null>(
    null,
  );
  const [mcBusy, setMcBusy] = useState(false);

  const initialForm = {
    leave_type_id: "",
    start_date: "",
    end_date: "",
    durations: {} as Record<string, DayDuration>,
    reason: "",
    ec_name: "",
    ec_phone: "",
    ec_relationship: "",
  };

  const [form, setForm] = useState(initialForm);

  // Compassionate Leave is grant-only. Show it in the dropdown only when
  // the employee has an available balance from an approved grant.
  const visibleLeaveTypes = leaveTypes.filter(
    (lt) => lt.name !== "Compassionate Leave" || compassionateAvailable > 0,
  );

  const holidaySet = useMemo(
    () => new Set(holidays.map((h) => h.date)),
    [holidays],
  );

  const dateList = useMemo(() => {
    if (!form.start_date || !form.end_date) return [];
    return workingDates(form.start_date, form.end_date, holidaySet);
  }, [form.start_date, form.end_date, holidaySet]);

  const total = useMemo(() => {
    return dateList.reduce(
      (sum, d) => sum + UNITS[form.durations[d] ?? "full_day"],
      0,
    );
  }, [dateList, form.durations]);

  function resetForm() {
    setForm(initialForm);
    setError("");
    setMcFile(null);
    setMcMeta(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  async function handleMcChange(file: File | null) {
    setMcFile(file);
    setMcMeta(null);
    if (!file) return;
    setMcBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadMcCertificate(fd);
    setMcBusy(false);
    if (!result.ok) {
      setError(result.error);
      setMcFile(null);
      return;
    }
    setMcMeta({ path: result.path, name: result.name });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mcFile && !mcMeta) {
      setError("MC file is still uploading, please wait");
      return;
    }

    startTransition(async () => {
      const days = dateList.map((date) => ({
        date,
        duration: form.durations[date] ?? ("full_day" as DayDuration),
      }));

      const emergencyContact =
        form.ec_name || form.ec_phone || form.ec_relationship
          ? {
              name: form.ec_name.trim(),
              phone: form.ec_phone.trim(),
              relationship: form.ec_relationship.trim(),
            }
          : undefined;

      const result = await createLeaveRequest({
        leave_type_id: form.leave_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        days,
        reason: form.reason,
        emergency_contact: emergencyContact,
        mc: mcMeta ?? undefined,
      });

      if (!result.ok) {
        setError(result.error ?? "Failed to submit request");
        return;
      }

      setOpen(false);
      resetForm();
    });
  }

  const spanDays =
    form.start_date && form.end_date
      ? differenceInCalendarDays(
          parseISO(form.end_date),
          parseISO(form.start_date),
        ) + 1
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Request Leave
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Leave Request</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Leave Type</label>
            <Select
              value={form.leave_type_id}
              onValueChange={(v) =>
                setForm({ ...form, leave_type_id: v ?? "" })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select leave type">
                  {form.leave_type_id
                    ? leaveTypes.find((lt) => lt.id === form.leave_type_id)
                        ?.name
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {visibleLeaveTypes.map((lt) => (
                  <SelectItem key={lt.id} value={lt.id}>
                    {lt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Start Date
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>

          {dateList.length > 0 && (
            <div className="rounded-md border bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-600">
                <span>
                  {dateList.length} working day
                  {dateList.length === 1 ? "" : "s"} ({spanDays} calendar)
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  Total: {total} day{total === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {dateList.map((date) => {
                  const value = form.durations[date] ?? "full_day";
                  return (
                    <li
                      key={date}
                      className="flex items-center justify-between gap-2 rounded border bg-white px-2 py-1.5 text-sm"
                    >
                      <span className="font-medium">
                        {format(parseISO(date), "EEE, MMM d")}
                      </span>
                      <Select
                        value={value}
                        onValueChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            durations: {
                              ...f.durations,
                              [date]: v as DayDuration,
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_day">Full Day</SelectItem>
                          <SelectItem value="half_day_morning">
                            Half Day (Morning)
                          </SelectItem>
                          <SelectItem value="half_day_evening">
                            Half Day (Evening)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">
              Emergency Contact{" "}
              <span className="text-xs font-normal text-gray-500">
                (optional)
              </span>
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="ec-name"
                  className="mb-1 block text-xs font-medium text-gray-600"
                >
                  Name
                </label>
                <input
                  id="ec-name"
                  type="text"
                  value={form.ec_name}
                  onChange={(e) =>
                    setForm({ ...form, ec_name: e.target.value })
                  }
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="ec-phone"
                  className="mb-1 block text-xs font-medium text-gray-600"
                >
                  Phone
                </label>
                <input
                  id="ec-phone"
                  type="tel"
                  value={form.ec_phone}
                  onChange={(e) =>
                    setForm({ ...form, ec_phone: e.target.value })
                  }
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="ec-rel"
                  className="mb-1 block text-xs font-medium text-gray-600"
                >
                  Relationship
                </label>
                <input
                  id="ec-rel"
                  type="text"
                  value={form.ec_relationship}
                  onChange={(e) =>
                    setForm({ ...form, ec_relationship: e.target.value })
                  }
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </fieldset>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Medical Certificate (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => handleMcChange(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
              />
              {mcFile && (
                <button
                  type="button"
                  className="rounded-md border p-1 text-gray-500 hover:bg-gray-100"
                  onClick={() => {
                    setMcFile(null);
                    setMcMeta(null);
                  }}
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {mcBusy && <p className="mt-1 text-xs text-gray-500">Uploading…</p>}
            {mcMeta && (
              <p className="mt-1 text-xs text-green-700">
                Attached: {mcMeta.name}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Reason</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Reason for leave"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || mcBusy}>
              {pending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
