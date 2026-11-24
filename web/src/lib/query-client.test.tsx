import { act, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider, useMutation } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/sonner"
import { request } from "@/lib/api"
import { createQueryClient } from "@/lib/query-client"
import { server } from "@/test/server"

function Generate({ silent = false }: { silent?: boolean }) {
  const mutation = useMutation({
    mutationFn: () => request("/api/templates/invoice/generate", { json: { input: {} } }),
    meta: { silentError: silent },
  })
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      {mutation.isError ? "failed" : "generate"}
    </button>
  )
}

function renderWith(ui: React.ReactElement) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  )
}

describe("mutation error toasts", () => {
  it("toasts CODE: message with the formatted field errors", async () => {
    server.use(
      http.post("*/api/templates/invoice/generate", () =>
        HttpResponse.json(
          {
            code: "FIELDS_INVALID",
            message: "Invalid fields: date (expected YYYY-MM-DD)",
            details: { errors: [{ name: "date", message: "expected YYYY-MM-DD" }] },
          },
          { status: 400 },
        ),
      ),
    )
    renderWith(<Generate />)
    await act(async () => screen.getByRole("button", { name: "generate" }).click())
    expect(await screen.findByText("FIELDS_INVALID: Invalid fields: date (expected YYYY-MM-DD)")).toBeInTheDocument()
    expect(screen.getByText("date: expected YYYY-MM-DD")).toBeInTheDocument()
  })

  it("stays quiet when the mutation handles its own errors (meta.silentError)", async () => {
    server.use(
      http.post("*/api/templates/invoice/generate", () =>
        HttpResponse.json({ code: "SILENT_CASE", message: "Handled by the form", details: { errors: [] } }, { status: 400 }),
      ),
    )
    renderWith(<Generate silent />)
    await act(async () => screen.getByRole("button", { name: "generate" }).click())
    await waitFor(() => expect(screen.getByRole("button", { name: "failed" })).toBeInTheDocument())
    expect(screen.queryByText(/SILENT_CASE/)).not.toBeInTheDocument()
  })
})
