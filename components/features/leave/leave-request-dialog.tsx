"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeaveRequest } from "@/lib/actions";
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
import type { LeaveType } from "@/lib/types";
import { Plus } from "lucide-react";

interface Props {
  leaveTypes: LeaveType[];
}

export function LeaveRequestDialog({ leaveTypes }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();

  const initialForm = {
    leave_type_id: "",
    start_date: "",
    end_date: "",
    duration_type: "full_day" as "full_day" | "half_day",
    reason: "",
  };

  const [form, setForm] = useState(initialForm);

  function resetForm() {
    setForm(initialForm);
    setError("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    startTransition(async () => {
      const result = await createLeaveRequest({
        leave_type_id: form.leave_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        duration_type: form.duration_type,
        reason: form.reason,
      });

      if (!result.ok) {
        setError(result.error ?? "Failed to submit request");
        return;
      }

      setOpen(false);
      setForm({
        leave_type_id: "",
        start_date: "",
        end_date: "",
        duration_type: "full_day",
        reason: "",
      });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Request Leave
      </DialogTrigger>
      <DialogContent>
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
                {leaveTypes.map((lt) => (
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

          <div>
            <label className="mb-1 block text-sm font-medium">Duration</label>
            <Select
              value={form.duration_type}
              onValueChange={(v) => {
                // Both half-day options submit the same DB enum value;
                // the morning/evening distinction is UI-only.
                const value = v as "full_day" | "half_day_morning" | "half_day_evening";
                if (value === "half_day_morning" || value === "half_day_evening") {
                  setForm({ ...form, duration_type: "half_day" });
                } else {
                  setForm({ ...form, duration_type: value });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select duration">
                  {form.duration_type === "full_day" ? "Full Day" : "Half Day"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_day">Full Day</SelectItem>
                <SelectItem value="half_day_morning">Half Day (Morning)</SelectItem>
                <SelectItem value="half_day_evening">Half Day (Evening)</SelectItem>
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
