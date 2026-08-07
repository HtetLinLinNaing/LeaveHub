"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { revalidateHolidays } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import type { Holiday } from "@/lib/types";

export function HolidayList({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const supabase = createClient();
      await supabase.from("holidays").delete().eq("id", id);
      await revalidateHolidays();
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  const columns: Column<Holiday>[] = [
    { key: "name", header: "Holiday", cell: (h) => h.name },
    { key: "date", header: "Date", cell: (h) => format(new Date(h.date), "MMM d, yyyy") },
    { key: "actions", header: "Actions", cell: (h) => (
      <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={deletingId === h.id}>
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
    ) },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={holidays}
      keyOf={(h) => h.id}
      mobileCard={(h) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">{h.name}</div>
            <div className="text-sm text-gray-500">{format(new Date(h.date), "MMM d, yyyy")}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={deletingId === h.id}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      )}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No holidays configured.
        </div>
      }
    />
  );
}
