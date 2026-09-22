import { warn } from "./log"

export const UPGRADE_GUIDE_URL = "https://tryweave.io/docs/upgrade-from-legacy/"

export const MOVED_NOTICE =
  "Weave has moved: @opencode_weave/weave is no longer maintained. " +
  `Switch to @weaveio/weave-adapter-opencode, and keep your agents and prompts, with the upgrade guide: ${UPGRADE_GUIDE_URL}`

type ToastOptions = {
  body: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }
}

type ToastClient = { tui?: { showToast?: (opts: ToastOptions) => Promise<unknown> } }

let logged = false
let toasted = false

/** Log the "Weave has moved" notice to OpenCode's app log, once per process. */
export function logMovedNotice(): void {
  if (logged) return
  logged = true
  warn(MOVED_NOTICE, { upgradeGuide: UPGRADE_GUIDE_URL })
}

/**
 * Show the "Weave has moved" notice as a TUI toast, once per process.
 * Called on the first session event, when the TUI is connected. A client
 * without a TUI (for example `opencode run`) is skipped silently.
 */
export function toastMovedNotice(client: unknown): void {
  if (toasted) return
  const tui = (client as ToastClient | null | undefined)?.tui
  if (!tui || typeof tui.showToast !== "function") return
  toasted = true
  // Call as a method on tui to preserve `this` for the SDK's generated classes.
  tui
    .showToast({
      body: {
        title: "Weave has moved",
        message: `@opencode_weave/weave is no longer maintained. Upgrade guide: ${UPGRADE_GUIDE_URL}`,
        variant: "warning",
        duration: 15000,
      },
    })
    .catch(() => {})
}

/** Test-only: allow the notice to be shown again. */
export function resetMovedNotice(): void {
  logged = false
  toasted = false
}
