import type * as React from "react"
import { MARK_BOWL, MARK_SPINE, MARK_VIEWBOX, WORDMARK, WORDMARK_VIEWBOX } from "@/components/logo-paths"
import { cn } from "@/lib/utils"

// The Dossier logo ("Bound D") drawn inline, so it follows the text colour: the bowl and the wordmark use
// currentColor and the spine is the single red accent (text-primary). Masters: web/brand-src/kit.

type LogoProps = Omit<React.ComponentProps<"svg">, "children" | "viewBox"> & {
  /** Accessible name. Without it the logo is decorative (aria-hidden), e.g. inside a labelled link. */
  title?: string
}

function a11y(title: string | undefined) {
  return title ? ({ role: "img", "aria-label": title } as const) : ({ "aria-hidden": true } as const)
}

/** The mark: spine and bowl of a D, split by one cut. Square; size it with `size-*` (default 32 px). */
export function LogoMark({ className, title, ...props }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={MARK_VIEWBOX}
      fill="currentColor"
      focusable="false"
      data-slot="logo-mark"
      className={cn("size-8 shrink-0", className)}
      {...a11y(title)}
      {...props}
    >
      <path data-part="bowl" fillRule="evenodd" d={MARK_BOWL} />
      <path data-part="spine" className="text-primary" fill="currentColor" d={MARK_SPINE} />
    </svg>
  )
}

/** The wordmark "Dossier" (Manrope SemiBold outlines). Size it by height; the width follows. */
export function LogoWordmark({ className, title, ...props }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WORDMARK_VIEWBOX}
      fill="currentColor"
      focusable="false"
      data-slot="logo-wordmark"
      className={cn("h-3.5 w-auto shrink-0", className)}
      {...a11y(title)}
      {...props}
    >
      <path d={WORDMARK} />
    </svg>
  )
}
