"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { ROLES } from "@/lib/constants";
import { ROLE_LABELS } from "@/lib/constants";
import { Plus } from "lucide-react";

interface Props {
  managers: { id: string; first_name: string; last_name: string }[];
}

export function EmployeeDialog({ managers }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    department: "",
    manager_id: "",
    join_date: "",
    role: "employee",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();

      // Generate employee code
      const { count } = await supabase
        .from("employees")
        .select("*", { count: "exact", head: true });

      const code = `EMP${String((count ?? 0) + 1).padStart(3, "0")}`;

      // Create user first
      const { data: user, error: userError } = await supabase
        .from("users")
        .insert({ email: form.email, role: form.role })
        .select()
        .single();

      if (userError) throw userError;

      // Create employee
      const { error: empError } = await supabase
        .from("employees")
        .insert({
          user_id: user.id,
          employee_code: code,
          first_name: form.first_name,
          last_name: form.last_name,
          department: form.department,
          manager_id: form.manager_id || null,
          join_date: form.join_date,
          status: "active",
        });

      if (empError) throw empError;

      // Create leave balances for current year
      const { data: leaveTypes } = await supabase
        .from("leave_types")
        .select("id, annual_days")
        .gt("annual_days", 0);

      if (leaveTypes) {
        const year = new Date().getFullYear();
        const { data: emp } = await supabase
          .from("employees")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (emp) {
          await supabase.from("leave_balances").insert(
            leaveTypes.map((lt) => ({
              employee_id: emp.id,
              leave_type_id: lt.id,
              year,
              allocated_days: lt.annual_days,
              used_days: 0,
              remaining_days: lt.annual_days,
              carry_forward_days: 0,
            }))
          );
        }
      }

      setOpen(false);
      setForm({
        first_name: "",
        last_name: "",
        email: "",
        department: "",
        manager_id: "",
        join_date: "",
        role: "employee",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Add Employee
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">First Name</label>
              <input
                type="text"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Last Name</label>
              <input
                type="text"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Department</label>
            <input
              type="text"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Role</label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v ?? "employee" })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Manager</label>
              <Select
                value={form.manager_id}
                onValueChange={(v) => setForm({ ...form, manager_id: v ?? "" })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Join Date</label>
            <input
              type="date"
              value={form.join_date}
              onChange={(e) => setForm({ ...form, join_date: e.target.value })}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Employee"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
