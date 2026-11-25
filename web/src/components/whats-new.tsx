import { SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"

const HIGHLIGHTS = [
  { title: "A new interface", text: "A dark, keyboard-friendly app with a sidebar, breadcrumbs and a command palette (⌘K)." },
  { title: "Same vault, same rules", text: "Numbering, statuses and clearance stay in the server; the app reads them from the API." },
  { title: "Every page, one app", text: "Dashboard, vault, documents, entities, the generator with live preview, upload and the settings editors." },
]

/** Sidebar footer card announcing the new interface, with the details in a dialog. Hidden in the icon rail. */
export function WhatsNewCard() {
  return (
    <Card size="sm" className="shadow-none group-data-[collapsible=icon]:hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          What's new
        </CardTitle>
        <CardDescription>Dossier 1.0 has a new app interface for every page.</CardDescription>
      </CardHeader>
      <CardFooter>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="w-full">See what changed</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>What's new in Dossier</DialogTitle>
              <DialogDescription>Highlights of the new app interface.</DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-3 text-sm">
              {HIGHLIGHTS.map((h) => (
                <li key={h.title} className="flex flex-col gap-0.5">
                  <span className="font-medium">{h.title}</span>
                  <span className="text-muted-foreground">{h.text}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Got it</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  )
}
