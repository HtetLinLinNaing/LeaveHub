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
  compassionateAvailableDays: number;
}

const COMPASSIONATE_NAME = "Compassionate Leave";

export function LeaveRequestDialog({
  leaveTypes,
  compassionateAvailableDays,
}: Props) {
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

  const selectedType = leaveTypes.find((lt) => lt.id === form.leave_type_id);
  const isCompassionate = selectedType?.name === COMPASSIONATE_NAME;
  const compassionateLocked = isCompassionate && compassionateAvailableDays <= 0;

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
      resetForm();
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
              <SelectTrigger className="w-50">
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
            {isCompassionate && (
              <p className="mt-1 text-xs text-gray-500">
                {compassionateAvailableDays} day(s) available from approved grants.
                {compassionateLocked && " Ask your manager to grant more."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                disabled={compassionateLocked}
                className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
                disabled={compassionateLocked}
                className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Duration</label>
            <Select
              value={form.duration_type}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  duration_type: v as "full_day" | "half_day",
                })
              }
              disabled={compassionateLocked}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select duration">
                  {form.duration_type === "full_day" ? "Full Day" : "Half Day"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_day">Full Day</SelectItem>
                <SelectItem value="half_day">Half Day</SelectItem>
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
              disabled={compassionateLocked}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100"
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
            <Button type="submit" disabled={pending || compassionateLocked}>
              {pending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
