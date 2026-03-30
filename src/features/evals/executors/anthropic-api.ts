/**
 * Anthropic Messages API caller for live eval execution.
 *
 * Parallel to github-models-api.ts — provides direct Anthropic API access
 * for Claude models. Uses only built-in fetch() — no new dependencies.
 *
 * Anthropic API differences from OpenAI:
 * - System prompt goes in top-level `system` field, not in messages array
 * - Auth uses `x-api-key` header, not `Authorization: Bearer`
 * - Response uses `content[0].text`, not `choices[0].message.content`
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
export const ANTHROPIC_API_VERSION = "2023-06-01"

export interface AnthropicResponse {
  content: string
  durationMs: number
}

export async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
): Promise<AnthropicResponse> {
  const start = Date.now()
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      temperature: 0,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`Anthropic API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const content = data.content?.[0]?.text ?? ""
  return { content, durationMs: Date.now() - start }
}
