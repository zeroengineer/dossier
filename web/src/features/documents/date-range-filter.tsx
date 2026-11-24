import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useMe } from "@/api/me"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { formatDate, parseDate } from "@/lib/format"

interface DateRangeFilterProps {
  /** Inclusive bounds on the document date, `YYYY-MM-DD`. */
  from: string | undefined
  to: string | undefined
  onChange: (range: { from: string | undefined; to: string | undefined }) => void
}

const iso = (d: Date | undefined) => (d ? format(d, "yyyy-MM-dd") : undefined)

/** Document date range: Popover + range Calendar; either bound may be open. */
export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const { data: me } = useMe()
  const locale = me?.workspace.locale
  const selected: DateRange | undefined = from || to ? { from: from ? (parseDate(from) ?? undefined) : undefined, to: to ? (parseDate(to) ?? undefined) : undefined } : undefined
  const label = from || to ? `${from ? formatDate(from, "medium", locale) : "…"} – ${to ? formatDate(to, "medium", locale) : "…"}` : undefined

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <CalendarIcon data-icon="inline-start" />
          Date
          {label ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary">{label}</Badge>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={(range) => onChange({ from: iso(range?.from), to: iso(range?.to) })}
        />
        {label ? (
          <>
            <Separator />
            <div className="flex justify-end px-2 pb-2">
              <Button variant="ghost" size="sm" onClick={() => onChange({ from: undefined, to: undefined })}>
                Clear dates
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
