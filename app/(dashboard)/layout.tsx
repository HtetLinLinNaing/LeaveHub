import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionFromRequest } from "@/lib/auth";
import { Sidebar } from "@/components/shared/sidebar";
import { SidebarProvider } from "@/components/shared/sidebar-context";
import { MobileTopBar } from "@/components/shared/mobile-top-bar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());

  if (!session) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar role={session.role} email={session.email} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
