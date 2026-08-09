"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { clearMockSession } from "@/lib/auth";
import type { Role } from "@/lib/types";
import {
  LayoutDashboard,
  CalendarDays,
  FileText,
  CheckCircle,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSidebar, useSidebarIsOpen } from "@/components/shared/sidebar-context";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: Role[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["employee", "manager", "admin"] },
  { label: "My Leave", href: "/leave", icon: FileText, roles: ["employee", "manager"] },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, roles: ["employee", "manager", "admin"] },
  { label: "Approvals", href: "/approvals", icon: CheckCircle, roles: ["manager", "admin"] },
  { label: "Employees", href: "/employees", icon: Users, roles: ["admin"] },
  { label: "Policies", href: "/policies", icon: Settings, roles: ["admin"] },
];

function SidebarContent({ role, email }: { role: Role; email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { close } = useSidebar();

  const filteredItems = navItems.filter((item) => item.roles.includes(role));

  function handleLogout() {
    clearMockSession();
    close();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex h-14 items-center border-b px-4">
        <h1 className="text-lg font-bold">LeaveHub</h1>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {filteredItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 px-3 text-xs text-gray-500">{email}</div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ role, email }: { role: Role; email: string }) {
  const isOpen = useSidebarIsOpen();
  const { close } = useSidebar();
  const pathname = usePathname();

  // Close drawer on navigation
  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <>
      {/* Mobile: off-canvas drawer */}
      <div className="md:hidden">
        <Sheet open={isOpen} onOpenChange={(v) => (v ? null : close())}>
          <SheetContent
            side="left"
            className="w-64 max-w-full p-0"
            showCloseButton={false}
          >
            <SidebarContent role={role} email={email} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Tablet/Desktop: persistent aside */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-white md:flex">
        <SidebarContent role={role} email={email} />
      </aside>
    </>
  );
}
