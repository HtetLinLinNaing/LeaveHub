"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { revalidateLeaveTypes } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import type { LeaveType } from "@/lib/types";
import { Pencil, Save, X } from "lucide-react";

export function LeaveTypeList({ leaveTypes }: { leaveTypes: LeaveType[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDays, setEditDays] = useState(0);
  const [saving, setSaving] = useState(false);

  function startEdit(lt: LeaveType) {
    setEditingId(lt.id);
    setEditDays(lt.annual_days);
  }

  async function handleSave(id: string) {
    setSaving(true);
    try {
      const supabase = createClient();
      await supabase
        .from("leave_types")
        .update({ annual_days: editDays })
        .eq("id", id);
      await revalidateLeaveTypes();
      router.refresh();
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  }

  function EditCell({ lt }: { lt: LeaveType }) {
    if (editingId !== lt.id) {
      return (
        <Button size="sm" variant="ghost" onClick={() => startEdit(lt)}>
          <Pencil className="h-4 w-4" />
        </Button>
      );
    }
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => handleSave(lt.id)} disabled={saving}>
          <Save className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const columns: Column<LeaveType>[] = [
    { key: "name", header: "Type", cell: (lt) => <span className="font-medium">{lt.name}</span> },
    { key: "days", header: "Days/Year", cell: (lt) => editingId === lt.id ? (
      <input
        type="number"
        value={editDays}
        onChange={(e) => setEditDays(Number(e.target.value))}
        className="w-20 rounded border px-2 py-1 text-sm"
        min={0}
      />
    ) : lt.annual_days },
    { key: "halfday", header: "Half Day", cell: (lt) => lt.allow_half_day ? "Yes" : "No" },
    { key: "actions", header: "Actions", cell: (lt) => <EditCell lt={lt} /> },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={leaveTypes}
      keyOf={(lt) => lt.id}
      mobileCard={(lt) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{lt.name}</span>
            <EditCell lt={lt} />
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>
              {editingId === lt.id ? (
                <input
                  type="number"
                  value={editDays}
                  onChange={(e) => setEditDays(Number(e.target.value))}
                  className="w-20 rounded border px-2 py-1 text-sm"
                  min={0}
                />
              ) : (
                <span><strong className="text-gray-900">{lt.annual_days}</strong> days/year</span>
              )}
            </span>
            <span>Half day: {lt.allow_half_day ? "Yes" : "No"}</span>
          </div>
        </div>
      )}
    />
  );
}
