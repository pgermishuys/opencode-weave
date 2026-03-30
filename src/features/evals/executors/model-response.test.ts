import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { executeModelResponse } from "./model-response"

describe("executeModelResponse", () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (savedEnv.GITHUB_TOKEN !== undefined) {
      process.env.GITHUB_TOKEN = savedEnv.GITHUB_TOKEN
    } else {
      delete process.env.GITHUB_TOKEN
    }
    if (savedEnv.ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it("throws when GITHUB_TOKEN is missing for GitHub Models provider", async () => {
    delete process.env.GITHUB_TOKEN

    expect(
      executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "system prompt" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "test input",
        },
        { mode: "local", directory: process.cwd() },
      ),
    ).rejects.toThrow("GITHUB_TOKEN")
  })

  it("throws when ANTHROPIC_API_KEY is missing for Anthropic provider", async () => {
    delete process.env.ANTHROPIC_API_KEY

    expect(
      executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "system prompt" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "test input",
        },
        { mode: "local", directory: process.cwd(), modelOverride: "claude-sonnet-4-20250514" },
      ),
    ).rejects.toThrow("ANTHROPIC_API_KEY")
  })

  it("routes to Anthropic API when model override is a claude model", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl: string | URL | Request = ""
    let capturedHeaders: Record<string, string> = {}

    Object.assign(globalThis, {
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = url
        capturedHeaders = { ...(init?.headers as Record<string, string>) }
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "I will delegate to thread for exploration." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "system prompt" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "find auth files",
        },
        { mode: "local", directory: process.cwd(), modelOverride: "claude-sonnet-4-20250514" },
      )

      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages")
      expect(capturedHeaders["x-api-key"]).toBe("test-anthropic-key")
      expect(artifacts.modelOutput).toBe("I will delegate to thread for exploration.")
      expect((artifacts.baselineDelta as { provider: string }).provider).toBe("a***c")
      expect((artifacts.baselineDelta as { model: string }).model).toBe("claude-sonnet-4-20250514")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("calls GitHub Models API and returns model output with sanitized metadata", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "I will delegate to thread for exploration." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    process.env.GITHUB_TOKEN = "test-token"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "system prompt" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "find auth files",
        },
        { mode: "local", directory: process.cwd() },
      )

      expect(artifacts.modelOutput).toBe("I will delegate to thread for exploration.")
      expect((artifacts.baselineDelta as { provider: string }).provider).toBe("g***s")
      expect((artifacts.baselineDelta as { model: string }).model).toBe("gpt-4o-mini")
      expect((artifacts.baselineDelta as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("does not leak input text into provider metadata artifacts", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "delegate to pattern" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    process.env.GITHUB_TOKEN = "test-token"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "prompt" },
        },
        {
          kind: "model-response",
          provider: "openai",
          model: "gpt-4o-mini",
          input: "Bearer sk-secret-token",
        },
        { mode: "local", directory: process.cwd() },
      )

      const serialized = JSON.stringify(artifacts)
      expect(serialized).not.toContain("sk-secret-token")
      expect(serialized).not.toContain("Bearer")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("passes executor.model directly to the API (no model name resolution)", async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: unknown

    Object.assign(globalThis, {
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    process.env.GITHUB_TOKEN = "test-token"

    try {
      await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "system" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "test",
        },
        { mode: "local", directory: process.cwd() },
      )

      expect((capturedBody as { model: string }).model).toBe("gpt-4o-mini")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("redacts resolved provider in baselineDelta (github-models for non-claude)", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    process.env.GITHUB_TOKEN = "test-token"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "prompt" },
        },
        {
          kind: "model-response",
          provider: "ai",
          model: "gpt-4o-mini",
          input: "test",
        },
        { mode: "local", directory: process.cwd() },
      )

      // Resolved provider is "github-models" (non-claude model), redacted to "g***s"
      expect((artifacts.baselineDelta as { provider: string }).provider).toBe("g***s")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("redacts anthropic provider in baselineDelta", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    process.env.ANTHROPIC_API_KEY = "test-key"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "prompt" },
        },
        {
          kind: "model-response",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          input: "test",
        },
        { mode: "local", directory: process.cwd() },
      )

      // "anthropic" -> "a***c"
      expect((artifacts.baselineDelta as { provider: string }).provider).toBe("a***c")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("uses model override to determine provider even when executor says github-models", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl: string | URL | Request = ""

    Object.assign(globalThis, {
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = url
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })
    process.env.ANTHROPIC_API_KEY = "test-key"

    try {
      await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "prompt" },
        },
        {
          kind: "model-response",
          provider: "github-models",
          model: "gpt-4o-mini",
          input: "test",
        },
        { mode: "local", directory: process.cwd(), modelOverride: "claude-sonnet-4-20250514" },
      )

      // Should route to Anthropic despite executor.provider being "github-models"
      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("does not leak ANTHROPIC_API_KEY into artifacts", async () => {
    const originalFetch = globalThis.fetch
    Object.assign(globalThis, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "delegate to pattern" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    })
    process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret-key"

    try {
      const artifacts = await executeModelResponse(
        {
          target: { kind: "builtin-agent-prompt", agent: "loom" },
          artifacts: { renderedPrompt: "prompt" },
        },
        {
          kind: "model-response",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          input: "test",
        },
        { mode: "local", directory: process.cwd() },
      )

      const serialized = JSON.stringify(artifacts)
      expect(serialized).not.toContain("sk-ant-super-secret-key")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
