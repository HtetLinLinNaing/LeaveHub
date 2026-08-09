"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompassionateGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HandHeart } from "lucide-react";

interface DirectReport {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
}

interface Props {
  directReports: DirectReport[];
}

export function GrantCompassionateDialog({ directReports }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();

  function reset() {
    setError("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    // Read everything from the form so we never depend on async state
    // flushes between selection and submit.
    const formData = new FormData(e.currentTarget);
    const employeeId = (formData.get("employee_id") as string) || "";
    const days = (formData.get("days") as string) || "";
    const reason = (formData.get("reason") as string) || "";

    if (!employeeId) {
      setError("Please select an employee");
      return;
    }
    const daysNum = Number(days);
    if (!daysNum || daysNum <= 0) {
      setError("Days must be a positive number");
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }

    startTransition(async () => {
      const result = await createCompassionateGrant({
        employee_id: employeeId,
        days: daysNum,
        reason,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to file grant");
        return;
      }
      setOpen(false);
      reset();
      e.currentTarget.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" />}>
        <HandHeart className="mr-2 h-4 w-4" />
        Grant Compassionate Leave
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant Compassionate Leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="employee_id"
              className="mb-1 block text-sm font-medium"
            >
              Employee
            </label>
            <select
              id="employee_id"
              name="employee_id"
              required
              defaultValue=""
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select employee
              </option>
              {directReports.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_name} ({d.employee_code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="days" className="mb-1 block text-sm font-medium">
              Days
            </label>
            <input
              id="days"
              name="days"
              type="number"
              min="0.5"
              max="30"
              step="0.5"
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. 1"
            />
          </div>

          <div>
            <label htmlFor="reason" className="mb-1 block text-sm font-medium">
              Reason
            </label>
            <textarea
              id="reason"
              name="reason"
              required
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Reason for granting compassionate leave"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <p className="text-xs text-gray-500">
            The grant is filed as Pending Admin Approval. Once admin approves,
            the employee can use the leave by submitting a normal request.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "File Grant"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
