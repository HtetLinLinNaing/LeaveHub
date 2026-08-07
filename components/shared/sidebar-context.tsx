"use client"

import * as React from "react"

type SidebarContextValue = {
  open: () => void
  close: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)
const SidebarIsOpenContext = React.createContext<boolean>(false)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false)
  const open = React.useCallback(() => setIsOpen(true), [])
  const close = React.useCallback(() => setIsOpen(false), [])

  return (
    <SidebarContext.Provider value={{ open, close }}>
      <SidebarIsOpenContext.Provider value={isOpen}>
        {children}
      </SidebarIsOpenContext.Provider>
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider")
  }
  return ctx
}

// Only re-renders when the open/closed state actually flips. Consumers that
// only need the actions should use useSidebar() above to avoid re-rendering
// on every toggle.
export function useSidebarIsOpen(): boolean {
  return React.useContext(SidebarIsOpenContext)
}
