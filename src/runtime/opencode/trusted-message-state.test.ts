import { describe, expect, it } from "bun:test"
import { createTrustedMessageState } from "./trusted-message-state"

describe("trusted-message-state", () => {
  it("consumes reviewer-fanout injected prompt with kind and nonce", () => {
    const state = createTrustedMessageState()
    state.registerInjectedPrompt("sess-1", "Injected reviewer fan-out payload", { kind: "reviewer-fanout", nonce: "abc-123" })

    expect(state.consumeInjectedPrompt("sess-1", "Injected reviewer fan-out payload")).toEqual({ kind: "reviewer-fanout", nonce: "abc-123" })
  })

  it("consumes generic injected prompt metadata", () => {
    const state = createTrustedMessageState()
    state.registerInjectedPrompt("sess-1", "Injected generic payload")

    expect(state.consumeInjectedPrompt("sess-1", "Injected generic payload")).toEqual({ kind: "generic" })
  })

  it("upgrades generic registration to reviewer-fanout for same text", () => {
    const state = createTrustedMessageState()
    state.registerInjectedPrompt("sess-1", "same payload")
    state.registerInjectedPrompt("sess-1", "same payload", { kind: "reviewer-fanout", nonce: "nonce-1" })

    expect(state.consumeInjectedPrompt("sess-1", "same payload")).toEqual({ kind: "reviewer-fanout", nonce: "nonce-1" })
  })

  it("consumption is single-use", () => {
    const state = createTrustedMessageState()
    state.registerInjectedPrompt("sess-1", "Injected reviewer fan-out payload", { kind: "reviewer-fanout", nonce: "abc-123" })

    expect(state.consumeInjectedPrompt("sess-1", "Injected reviewer fan-out payload")).toEqual({ kind: "reviewer-fanout", nonce: "abc-123" })
    expect(state.consumeInjectedPrompt("sess-1", "Injected reviewer fan-out payload")).toBeNull()
    expect(state.consumeTrustedEnvelope("sess-1", "Injected reviewer fan-out payload")).toBeNull()
  })
})
