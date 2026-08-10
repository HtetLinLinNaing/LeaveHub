"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeaveGrant } from "@/lib/actions";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Plus } from "lucide-react";

interface EmployeeOption {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
}

interface Props {
  employees: EmployeeOption[];
}

export function GrantProposeDialog({ employees }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [leaveTypeName, setLeaveTypeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");

  function reset() {
    setLeaveTypeName("");
    setEmployeeId("");
    setDays(1);
    setReason("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Defensive client-side check. base-ui Select occasionally drops
    // onValueChange in controlled mode, leaving the state empty even
    // though the trigger shows the chosen label. Catch it here so the
    // user gets an actionable message instead of "Invalid UUID".
    if (!employeeId) {
      setError("Please select an employee");
      return;
    }
    if (!leaveTypeName) {
      setError("Please select a leave type");
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)) {
      setError("Employee selection is invalid — please re-pick the employee");
      return;
    }

    startTransition(async () => {
      const result = await createLeaveGrant({
        employee_id: employeeId,
        leave_type_name: leaveTypeName,
        days,
        reason,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to submit grant");
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Propose Grant
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose Leave Grant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Leave Type</label>
            <Select
              value={leaveTypeName}
              onValueChange={(v) => setLeaveTypeName(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select leave type">
                  {leaveTypeName || undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {GRANT_DRIVEN_LEAVE_TYPES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Employee</label>
            <Select
              value={employeeId}
              onValueChange={(v) => setEmployeeId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select employee">
                  {(value: string | null) => {
                    if (!value) return undefined;
                    const e = employees.find((x) => x.id === value);
                    return e
                      ? `${e.first_name} ${e.last_name} (${e.employee_code})`
                      : undefined;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.first_name} {e.last_name} ({e.employee_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Number of days
            </label>
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
              maxLength={500}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. Death of grandmother"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
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
            <Button
              type="submit"
              disabled={pending || !employeeId || !reason || !leaveTypeName}
            >
              {pending ? "Submitting..." : "Submit Grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
