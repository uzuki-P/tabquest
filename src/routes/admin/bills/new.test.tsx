// Regression test: the receipt image picked on the first wizard step has to
// survive switching steps. The file inputs are uncontrolled, so unmounting
// the receipt step used to drop both the preview and the chosen file.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { NewBillPage } from "./new"

afterEach(cleanup)

// happy-dom has no blob URL store; the preview only needs a usable src.
URL.createObjectURL = () => "blob:test"
URL.revokeObjectURL = () => {}

function renderNewBillPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const newBillRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/bills/new",
    component: NewBillPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([newBillRoute]),
    history: createMemoryHistory({ initialEntries: ["/admin/bills/new"] }),
  })
  return render(<RouterProvider router={router} />)
}

function chooseReceiptImage() {
  const input = screen.getByLabelText("Receipt image")
  const file = new File(["fake-png-bytes"], "receipt.png", {
    type: "image/png",
  })
  Object.defineProperty(input, "files", { value: [file] })
  fireEvent.change(input)
}

test("receipt image and preview survive switching wizard steps", async () => {
  renderNewBillPage()
  // The breadcrumb repeats the page title, so match the heading role.
  await screen.findByRole("heading", { name: "New bill" })

  fireEvent.change(screen.getByLabelText("Merchant"), {
    target: { value: "Warung Test" },
  })
  chooseReceiptImage()

  expect(screen.getByAltText("Receipt image preview")).toBeTruthy()

  // Step pill names change once a step is done (the number span becomes a
  // check icon), so match on the title within the steps list.
  const steps = screen.getByRole("list", { name: "Steps" })
  fireEvent.click(within(steps).getByRole("button", { name: "2 Items & fees" }))
  expect(screen.getByText("Add item")).toBeTruthy()

  fireEvent.click(within(steps).getByRole("button", { name: /^Receipt/ }))

  const input = screen.getByLabelText<HTMLInputElement>("Receipt image")
  expect(input.files?.length).toBe(1)
  expect(input.files?.[0]?.name).toBe("receipt.png")
  expect(screen.getByAltText("Receipt image preview")).toBeTruthy()
})

test("final step offers separate save-draft and publish actions", async () => {
  renderNewBillPage()
  await screen.findByRole("heading", { name: "New bill" })

  fireEvent.change(screen.getByLabelText("Merchant"), {
    target: { value: "Warung Test" },
  })

  const steps = screen.getByRole("list", { name: "Steps" })
  fireEvent.click(
    within(steps).getByRole("button", { name: "4 Split & review" })
  )

  // The board header has its own save button, the wizard footer a second
  // one next to Publish. Saving must not navigate away; publishing opens
  // the bill detail page.
  expect(screen.getAllByRole("button", { name: "Save draft" }).length).toBe(2)
  expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy()
})
