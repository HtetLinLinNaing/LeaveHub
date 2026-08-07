import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getMockSessionFromCookie, type MockSession } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const session = getMockSessionFromCookie(cookieHeader);

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar role={session.role} email={session.email} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
