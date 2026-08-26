import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";

type GrantAmountRow = { leave_type_id: string; days: number };
type GrantTypeRow = { id: string; name: string };

export interface GrantDrivenOverviewEntry {
  leaveTypeId: string;
  leaveTypeName: string;
  granted: number;
  used: number;
  available: number;
  pending: number;
}

export interface GrantOverviewReader {
  loadTypes(): Promise<GrantTypeRow[]>;
  loadApproved(typeIds: string[]): Promise<GrantAmountRow[]>;
  loadUsed(typeIds: string[]): Promise<GrantAmountRow[]>;
  loadPending(typeIds: string[]): Promise<GrantAmountRow[]>;
}

function totalsByType(rows: GrantAmountRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(
      row.leave_type_id,
      (totals.get(row.leave_type_id) ?? 0) + Number(row.days)
    );
  }
  return totals;
}

export async function loadGrantDrivenOverview(
  reader: GrantOverviewReader
): Promise<GrantDrivenOverviewEntry[]> {
  const types = (await reader.loadTypes()).filter((type) =>
    (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
  );
  if (types.length === 0) return [];

  const typeIds = types.map((type) => type.id);
  const [approvedRows, usedRows, pendingRows] = await Promise.all([
    reader.loadApproved(typeIds),
    reader.loadUsed(typeIds),
    reader.loadPending(typeIds),
  ]);
  const approved = totalsByType(approvedRows);
  const used = totalsByType(usedRows);
  const pending = totalsByType(pendingRows);

  return types
    .map((type) => {
      const granted = approved.get(type.id) ?? 0;
      const consumed = used.get(type.id) ?? 0;
      const waiting = pending.get(type.id) ?? 0;
      return {
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        granted,
        used: consumed,
        available: Math.max(granted - consumed, 0),
        pending: waiting,
      };
    })
    .filter((entry) => entry.granted > 0 || entry.used > 0 || entry.pending > 0);
}
