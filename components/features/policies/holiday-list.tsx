"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteHoliday } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import type { Holiday } from "@/lib/types";

export function HolidayList({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function handleDelete(id: string) {
    setError("");
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteHoliday(id);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete holiday");
      }
      setDeletingId(null);
      router.refresh();
    });
  }

  const columns: Column<Holiday>[] = [
    { key: "name", header: "Holiday", cell: (h) => h.name },
    { key: "date", header: "Date", cell: (h) => format(new Date(h.date), "MMM d, yyyy") },
    { key: "actions", header: "Actions", cell: (h) => (
      <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={pending && deletingId === h.id}>
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
    ) },
  ];

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
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
          <Button size="sm" variant="ghost" onClick={() => handleDelete(h.id)} disabled={pending && deletingId === h.id}>
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
    </div>
  );
}
