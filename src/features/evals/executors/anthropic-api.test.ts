import { describe, expect, it } from "bun:test"
import { callAnthropic, ANTHROPIC_API_URL, ANTHROPIC_API_VERSION } from "./anthropic-api"

describe("anthropic-api", () => {
  it("exports the expected API URL constant", () => {
    expect(ANTHROPIC_API_URL).toBe("https://api.anthropic.com/v1/messages")
  })

  it("exports the expected API version constant", () => {
    expect(ANTHROPIC_API_VERSION).toBe("2023-06-01")
  })

  it("throws on non-200 API response", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () => new Response("Rate limit exceeded", { status: 429 }),
    })

    try {
      await expect(
        callAnthropic("system", "user", "claude-sonnet-4-20250514", "fake-key"),
      ).rejects.toThrow("Anthropic API error 429")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("throws on 401 unauthorized", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () => new Response("Unauthorized", { status: 401 }),
    })

    try {
      await expect(
        callAnthropic("system", "user", "claude-sonnet-4-20250514", "bad-key"),
      ).rejects.toThrow("Anthropic API error 401")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("parses a valid API response", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "I will delegate to thread." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })

    try {
      const result = await callAnthropic("system prompt", "user message", "claude-sonnet-4-20250514", "test-key")
      expect(result.content).toBe("I will delegate to thread.")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("returns empty string when API response has no content", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    })

    try {
      const result = await callAnthropic("system", "user", "claude-sonnet-4-20250514", "test-key")
      expect(result.content).toBe("")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("sends correct request body with system as top-level field", async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: unknown

    Object.assign(globalThis, {
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      await callAnthropic("my system", "my user msg", "claude-sonnet-4-20250514", "tok123")
      expect(capturedBody).toEqual({
        model: "claude-sonnet-4-20250514",
        system: "my system",
        messages: [{ role: "user", content: "my user msg" }],
        temperature: 0,
        max_tokens: 1024,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("sends x-api-key and anthropic-version headers", async () => {
    const originalFetch = globalThis.fetch
    let capturedHeaders: Record<string, string> = {}

    Object.assign(globalThis, {
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>
        capturedHeaders = { ...headers }
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })

    try {
      await callAnthropic("sys", "usr", "claude-sonnet-4-20250514", "sk-ant-mysecret")
      expect(capturedHeaders["x-api-key"]).toBe("sk-ant-mysecret")
      expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01")
      expect(capturedHeaders["Content-Type"]).toBe("application/json")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
