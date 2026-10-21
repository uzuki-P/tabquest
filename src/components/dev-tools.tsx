import { useEffect } from "react"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

/**
 * Dev-only TanStack devtools shell. Root imports it lazily behind
 * `import.meta.env.DEV`, so it is never rendered or bundled in production.
 *
 * The trigger button is hidden (`triggerHidden`) and the hotkey is announced
 * in the console instead. The default hotkey matches keys in the order they
 * are held, so it only fires when Ctrl goes down before the `~` key.
 */
export default function DevTools() {
  useEffect(() => {
    console.log(
      "[devtools] hidden. Hold Ctrl, then press Shift+` to toggle TanStack devtools."
    )
  }, [])

  return (
    <TanStackDevtools
      config={{
        position: "bottom-right",
        triggerHidden: true,
      }}
      plugins={[
        {
          name: "Tanstack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
      ]}
    />
  )
}
