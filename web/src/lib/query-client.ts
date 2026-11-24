import { MutationCache, QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ApiError, errorMessage } from "./api"

/** Toast a failed mutation as `CODE: message`, with validation errors (`details.errors[]`) listed below. */
export function toastError(err: unknown) {
  const errors = err instanceof ApiError ? err.errors : []
  toast.error(errorMessage(err), errors.length ? { description: errors.slice(0, 5).join("\n") } : undefined)
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Set to true when the caller shows the error itself (form field errors), to skip the toast. */
      silentError?: boolean
    }
  }
}

export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.meta?.silentError) return
        toastError(err)
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}
