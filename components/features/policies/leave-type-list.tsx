"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
    const supabase = createClient();
    await supabase
      .from("leave_types")
      .update({ annual_days: editDays })
      .eq("id", id);
    setEditingId(null);
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left">
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Days/Year</th>
            <th className="px-4 py-3 font-medium">Half Day</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {leaveTypes.map((lt) => (
            <tr key={lt.id} className="border-b last:border-0">
              <td className="px-4 py-3 font-medium">{lt.name}</td>
              <td className="px-4 py-3">
                {editingId === lt.id ? (
                  <input
                    type="number"
                    value={editDays}
                    onChange={(e) => setEditDays(Number(e.target.value))}
                    className="w-20 rounded border px-2 py-1 text-sm"
                    min={0}
                  />
                ) : (
                  lt.annual_days
                )}
              </td>
              <td className="px-4 py-3">{lt.allow_half_day ? "Yes" : "No"}</td>
              <td className="px-4 py-3">
                {editingId === lt.id ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleSave(lt.id)}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(lt)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
