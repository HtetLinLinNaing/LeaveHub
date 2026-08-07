"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { revalidateHolidays } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

export function HolidayDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const [form, setForm] = useState({ name: "", date: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("holidays")
        .insert({ name: form.name, date: form.date });

      if (dbError) throw dbError;

      setOpen(false);
      setForm({ name: "", date: "" });
      await revalidateHolidays();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add holiday");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="mr-1 h-4 w-4" />
        Add Holiday
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Public Holiday</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Holiday Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. New Year's Day"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
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
              {loading ? "Adding..." : "Add Holiday"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
