import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "./confirm-dialog"

function setup(onConfirm: () => void | Promise<unknown>) {
  const user = userEvent.setup()
  render(
    <ConfirmDialog
      title="Remove relation?"
      description="DOC-000002 will no longer be linked."
      confirmLabel="Remove"
      onConfirm={onConfirm}
      trigger={<Button variant="outline">Unlink</Button>}
    />,
  )
  return user
}

describe("ConfirmDialog", () => {
  it("opens from its trigger with title, description and an outlined red confirm button", async () => {
    const user = setup(() => {})
    await user.click(screen.getByRole("button", { name: "Unlink" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Remove relation?" })
    expect(dialog).toHaveTextContent("DOC-000002 will no longer be linked.")
    const confirm = screen.getByRole("button", { name: "Remove" })
    expect(confirm).toHaveAttribute("data-variant", "destructive")
    expect(confirm.className).toContain("border-destructive")
  })

  it("cancel closes without confirming", async () => {
    const onConfirm = vi.fn()
    const user = setup(onConfirm)
    await user.click(screen.getByRole("button", { name: "Unlink" }))
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("shows a pending state while the async action runs and closes on success", async () => {
    let resolve!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    const user = setup(onConfirm)
    await user.click(screen.getByRole("button", { name: "Unlink" }))
    await user.click(await screen.findByRole("button", { name: "Remove" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Remove/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
    resolve()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("stays open when the action fails", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("STATUS_LOCKED")))
    const user = setup(onConfirm)
    await user.click(screen.getByRole("button", { name: "Unlink" }))
    await user.click(await screen.findByRole("button", { name: "Remove" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled())
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })
})
