"use client"

import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/shared/sidebar-context"

export function MobileTopBar() {
  const { open } = useSidebar();

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={open}
        aria-label="Open navigation"
        data-testid="mobile-hamburger"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="font-bold">LeaveHub</span>
    </div>
  );
}
