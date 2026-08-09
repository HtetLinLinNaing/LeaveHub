"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompassionateGrant } from "@/lib/actions";
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

  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");

  function reset() {
    setEmployeeId("");
    setDays(1);
    setReason("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createCompassionateGrant({
        employee_id: employeeId,
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
        Grant Compassionate Leave
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant Compassionate Leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Employee</label>
            <Select
              value={employeeId}
              onValueChange={(v) => setEmployeeId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select employee">
                  {employeeId
                    ? (() => {
                        const e = employees.find((x) => x.id === employeeId);
                        return e
                          ? `${e.first_name} ${e.last_name} (${e.employee_code})`
                          : undefined;
                      })()
                    : undefined}
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
              disabled={pending || !employeeId || !reason}
            >
              {pending ? "Submitting..." : "Submit Grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
