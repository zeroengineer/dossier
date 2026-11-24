import * as React from "react"
import { FileIcon, UploadIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatBytes } from "./upload-data"

interface DropZoneProps {
  file: File | null
  onFileChange: (file: File | null) => void
  /** Largest accepted file in bytes (`meta.limits.uploadMaxBytes`), shown as a hint. */
  maxBytes?: number
  disabled?: boolean
  invalid?: boolean
  id?: string
}

/** A file picker that also accepts a dropped file. One file at a time; a second drop replaces the first. */
export function DropZone({ file, onFileChange, maxBytes, disabled = false, invalid = false, id = "upload-file" }: DropZoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  function choose(files: FileList | null) {
    const next = files?.[0]
    if (next) onFileChange(next)
  }

  function clear() {
    onFileChange(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div
      data-slot="drop-zone"
      data-dragging={dragging || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card p-8 text-center shadow-sm transition-colors",
        "data-dragging:border-primary data-dragging:bg-accent aria-invalid:border-destructive",
        disabled && "pointer-events-none opacity-50",
      )}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) choose(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        aria-label="File"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => choose(e.currentTarget.files)}
      />
      {file ? (
        <div className="flex w-full max-w-md items-center gap-3 rounded-md border bg-background p-3 text-left">
          <FileIcon className="size-5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium" data-testid="upload-file-name">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={clear} aria-label="Remove file" disabled={disabled}>
            <XIcon />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <UploadIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Drop a file here</p>
            <p className="text-xs text-muted-foreground">
              Any file type{maxBytes ? `, up to ${formatBytes(maxBytes)}` : ""}. PDF, HTML and Markdown files can be viewed in place.
            </p>
          </div>
        </>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
        {file ? "Choose another file" : "Choose file"}
      </Button>
    </div>
  )
}
