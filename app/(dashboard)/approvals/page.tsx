import { redirect } from "next/navigation";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import { GrantProposeDialog } from "@/components/features/grants/grant-propose-dialog";
import { GrantApprovalList } from "@/components/features/grants/grant-approval-list";
import { MyGrantsList } from "@/components/features/grants/my-grants-list";
import { loadApprovalsPageData } from "@/lib/dal/approvals";
import { requireRequestContext } from "@/lib/dal/request-context";

export default async function ApprovalsPage() {
  const { actor, db } = await requireRequestContext();
  const data = await loadApprovalsPageData(actor, db);
  if (!data) redirect("/");

  const {
    requestsForList,
    pendingGrants,
    myGrants,
    directReportsForDialog,
  } = data;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>

      {(actor.role === "manager" || actor.role === "admin") && (
        <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Leave Grants</h2>
          <GrantProposeDialog employees={directReportsForDialog} />
        </div>
      )}

      {actor.role === "admin" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">Pending leave grants</h3>
          <GrantApprovalList grants={pendingGrants} />
        </section>
      )}

      {actor.role === "manager" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">My leave grants</h3>
          <MyGrantsList grants={myGrants} />
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Leave Requests</h2>
      <ApprovalList requests={requestsForList} />
    </div>
  );
}
