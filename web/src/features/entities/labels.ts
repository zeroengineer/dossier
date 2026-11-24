/** An enum value from `/api/meta` as a label: `business_line` → `Business line`. */
export function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

/** Label of an entity kind (`group_entity` → `Group entity`). */
export const kindLabel = humanize

/** A relation role inside a sentence (`employed_by` → `employed by`). */
export const roleLabel = (role: string) => role.replace(/[_-]+/g, " ").trim()

/** Path of an entity's page. */
export const entityPath = (id: number) => `/entities/${id}`
