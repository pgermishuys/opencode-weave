/**
 * GitHub Models API caller for live eval execution.
 *
 * Provides a fetch-based approach for calling GitHub Models API
 * in Phase 2 live eval harness. Uses only built-in fetch() — no new dependencies.
 */

export const GITHUB_MODELS_API_URL = "https://models.inference.ai.azure.com/chat/completions"
export const DELAY_BETWEEN_CALLS_MS = 1000

export interface GitHubModelsResponse {
  content: string
  durationMs: number
}

export async function callGitHubModels(
  systemPrompt: string,
  userMessage: string,
  model: string,
  token: string,
): Promise<GitHubModelsResponse> {
  const start = Date.now()
  const response = await fetch(GITHUB_MODELS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`GitHub Models API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content ?? ""
  return { content, durationMs: Date.now() - start }
}
