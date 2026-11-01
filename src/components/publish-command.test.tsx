// Component test for the publish command chip: clicking it must copy a
// command that works from a fresh terminal (cd into the checkout first),
// and the chip must turn green with a check while the copy is fresh.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, test } from "bun:test"

import { PROJECT_ROOT, PublishCommand } from "./publish-command"

afterEach(cleanup)

describe("publish command chip", () => {
  test("copies a cd-and-publish command and flashes green", async () => {
    const writes: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          writes.push(text)
        },
      },
      configurable: true,
    })

    render(<PublishCommand />)
    expect(screen.getByText("just publish")).toBeTruthy()

    const chip = screen.getByRole("button", {
      name: "Copy the publish command",
    })
    fireEvent.click(chip)

    // The pasted command must not depend on the shell's current directory.
    await waitFor(() =>
      expect(writes).toEqual([`cd ${PROJECT_ROOT} && just publish`])
    )

    // The copied state reads at a glance: success green border and text.
    await waitFor(() => {
      expect(chip.className).toContain("border-success")
      expect(chip.className).toContain("text-success")
      expect(chip.className).not.toContain("shadow-foreground")
    })
  })
})
