export const documentPath = (id: string) => `/documents/${encodeURIComponent(id)}`
export const entityPath = (id: number) => `/entities/${id}`
export const searchPath = (q: string) => `/search?${new URLSearchParams({ q }).toString()}`
export const generatePath = (templateId: string) => `/generate/${encodeURIComponent(templateId)}`
