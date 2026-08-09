"use client";

import { useState, createContext, useContext } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapseContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CollapseContext = createContext<CollapseContextValue | null>(null);

function useCollapse() {
  const ctx = useContext(CollapseContext);
  if (!ctx) throw new Error("Collapse components must be used within Collapse");
  return ctx;
}

export function Collapse({
  defaultOpen = false,
  children,
  className,
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapseContext.Provider value={{ open, setOpen }}>
      <div className={className}>{children}</div>
    </CollapseContext.Provider>
  );
}

export function CollapseTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen } = useCollapse();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex items-center gap-2 w-full text-left transition-colors cursor-pointer select-none",
        className
      )}
    >
      {children}
      <ChevronDown
        className={cn(
          "size-4 transition-transform duration-200 shrink-0 text-muted-foreground",
          open && "rotate-180"
        )}
      />
    </button>
  );
}

export function CollapseContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open } = useCollapse();
  if (!open) return null;
  return (
    <div
      className={cn(
        "animate-in fade-in-0 slide-in-from-top-1 duration-200",
        className
      )}
    >
      {children}
    </div>
  );
}
