/**
 * Per-session token state tracker.
 *
 * Bridges the gap between:
 * - `chat.params` hook → provides model context limit (maxTokens)
 * - `message.updated` event → provides latest input token usage (usedTokens)
 *
 * Uses an in-memory Map keyed by sessionId. State resets on plugin restart,
 * which is acceptable — data rebuilds on the next `chat.params` + `message.updated` pair.
 */

export interface SessionTokenEntry {
  maxTokens: number
  usedTokens: number
}

const sessionMap = new Map<string, SessionTokenEntry>()

/**
 * Store the model's context limit for a session.
 * Called from the `chat.params` hook when a session starts.
 * Does NOT overwrite existing `usedTokens`.
 */
export function setContextLimit(sessionId: string, maxTokens: number): void {
  const existing = sessionMap.get(sessionId)
  sessionMap.set(sessionId, {
    usedTokens: existing?.usedTokens ?? 0,
    maxTokens,
  })
}

/**
 * Update the latest input token usage for a session.
 * Called from `message.updated` events with AssistantMessage tokens.
 * Stores the latest value — NOT cumulative across messages.
 * Does NOT overwrite existing `maxTokens`.
 * Only updates when inputTokens > 0 (guards against partial streaming updates).
 */
export function updateUsage(sessionId: string, inputTokens: number): void {
  if (inputTokens <= 0) return
  const existing = sessionMap.get(sessionId)
  sessionMap.set(sessionId, {
    maxTokens: existing?.maxTokens ?? 0,
    usedTokens: inputTokens,
  })
}

/**
 * Get the current token state for a session.
 * Returns undefined if the session is unknown.
 */
export function getState(sessionId: string): SessionTokenEntry | undefined {
  return sessionMap.get(sessionId)
}

/**
 * Remove a session from the tracker.
 * Called on `session.deleted` events.
 */
export function clearSession(sessionId: string): void {
  sessionMap.delete(sessionId)
}

/**
 * Clear all session state. Used in tests only.
 */
export function clear(): void {
  sessionMap.clear()
}
