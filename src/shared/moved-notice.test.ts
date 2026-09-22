import { describe, it, expect, afterEach } from "bun:test"
import { setClient } from "./log"
import { MOVED_NOTICE, UPGRADE_GUIDE_URL, logMovedNotice, resetMovedNotice, toastMovedNotice } from "./moved-notice"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClient(): { client: any; logs: any[]; toasts: any[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toasts: any[] = []
  return {
    client: {
      app: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        log: (opts: any) => {
          logs.push(opts)
          return Promise.resolve(true)
        },
      },
      tui: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        showToast(opts: any) {
          toasts.push({ opts, self: this })
          return Promise.resolve(true)
        },
      },
    },
    logs,
    toasts,
  }
}

afterEach(() => {
  setClient(null)
  resetMovedNotice()
})

describe("moved notice", () => {
  it("points at the upgrade guide", () => {
    expect(MOVED_NOTICE).toContain("@weaveio/weave-adapter-opencode")
    expect(MOVED_NOTICE).toContain(UPGRADE_GUIDE_URL)
  })

  it("logs a warning once per process", async () => {
    const { client, logs } = mockClient()
    setClient(client)
    logMovedNotice()
    logMovedNotice()
    await Promise.resolve()
    expect(logs.length).toBe(1)
    expect(logs[0]).toMatchObject({ body: { service: "weave", level: "warn", message: MOVED_NOTICE } })
  })

  it("shows a warning toast once per process, called as a method on tui", () => {
    const { client, toasts } = mockClient()
    toastMovedNotice(client)
    toastMovedNotice(client)
    expect(toasts.length).toBe(1)
    expect(toasts[0].self).toBe(client.tui)
    expect(toasts[0].opts.body).toMatchObject({ title: "Weave has moved", variant: "warning" })
    expect(toasts[0].opts.body.message).toContain(UPGRADE_GUIDE_URL)
  })

  it("skips the toast when the client has no TUI, and still toasts later if one appears", () => {
    toastMovedNotice(undefined)
    toastMovedNotice({ app: {} })
    const { client, toasts } = mockClient()
    toastMovedNotice(client)
    expect(toasts.length).toBe(1)
  })

  it("ignores a rejected toast", async () => {
    const client = { tui: { showToast: () => Promise.reject(new Error("tui not connected")) } }
    expect(() => toastMovedNotice(client)).not.toThrow()
    await Promise.resolve()
  })
})
