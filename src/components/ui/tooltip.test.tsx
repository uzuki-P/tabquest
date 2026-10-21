// Component test for the tooltip wrapper: an open tooltip must portal its
// content, a closed one must render nothing extra.
import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

afterEach(cleanup)

test("an open tooltip portals its content", async () => {
  render(
    <Tooltip defaultOpen>
      <TooltipTrigger render={<span>trigger</span>} />
      <TooltipContent>the full text</TooltipContent>
    </Tooltip>
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  const popup = document.querySelector('[data-slot="tooltip-content"]')
  expect(popup?.textContent).toBe("the full text")
})

test("a closed tooltip renders no popup", () => {
  render(
    <Tooltip>
      <TooltipTrigger render={<span>trigger</span>} />
      <TooltipContent>the full text</TooltipContent>
    </Tooltip>
  )
  expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull()
})
