export interface SnippetPart {
  text: string
  mark: boolean
}

/**
 * Split a search snippet into plain and marked parts. The server marks matched terms as `[term]` (FTS5 snippet);
 * an unpaired `[` or `]` stays plain text.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  const push = (text: string, mark: boolean) => {
    if (text === "") return
    const last = parts[parts.length - 1]
    if (last && last.mark === mark) last.text += text
    else parts.push({ text, mark })
  }
  const re = /\[([^[\]]*)\]/g
  let at = 0
  for (let m = re.exec(snippet); m !== null; m = re.exec(snippet)) {
    push(snippet.slice(at, m.index), false)
    push(m[1] ?? "", true)
    at = m.index + m[0].length
  }
  push(snippet.slice(at), false)
  return parts
}

/** A search snippet as text with its matched terms in `<mark>` (React nodes, never raw HTML). */
export function Highlighted({ snippet, className }: { snippet: string; className?: string }) {
  return (
    <span className={className}>
      {splitSnippet(snippet).map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}
