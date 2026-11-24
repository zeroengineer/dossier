// Query keys. Every key starts with its resource so invalidation by prefix (`queryKey: keys.documents.all`) works.
export const keys = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  documents: {
    all: ["documents"] as const,
    list: (params: Record<string, unknown>) => ["documents", "list", params] as const,
    detail: (id: string) => ["documents", "detail", id] as const,
  },
  entities: {
    all: ["entities"] as const,
    list: (params: Record<string, unknown>) => ["entities", "list", params] as const,
    detail: (id: string) => ["entities", "detail", id] as const,
  },
  templates: {
    all: ["templates"] as const,
    detail: (id: string) => ["templates", "detail", id] as const,
  },
  search: (q: string) => ["search", q] as const,
  dashboard: (days: number) => ["dashboard", days] as const,
}
