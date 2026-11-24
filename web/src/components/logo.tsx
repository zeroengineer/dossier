import { cn } from "@/lib/utils"

// Temporary mark and wordmark until the logo kit (F20) replaces them.

export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}>
      <span className="text-sm font-extrabold">D</span>
    </span>
  )
}

export function LogoWordmark({ className }: { className?: string }) {
  return <span className={cn("font-heading text-base font-bold tracking-tight", className)}>Dossier</span>
}
