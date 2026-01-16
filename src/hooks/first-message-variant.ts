const appliedSessions = new Set<string>()
const createdSessions = new Set<string>()

export function markSessionCreated(sessionId: string): void {
  createdSessions.add(sessionId)
}

export function markApplied(sessionId: string): void {
  appliedSessions.add(sessionId)
}

export function shouldApplyVariant(sessionId: string): boolean {
  return createdSessions.has(sessionId) && !appliedSessions.has(sessionId)
}

export function clearSession(sessionId: string): void {
  appliedSessions.delete(sessionId)
  createdSessions.delete(sessionId)
}

export function clearAll(): void {
  appliedSessions.clear()
  createdSessions.clear()
}
