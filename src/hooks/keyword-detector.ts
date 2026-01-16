import { log } from "../shared/log"

export interface KeywordAction {
  keyword: string
  injection: string
}

export const DEFAULT_KEYWORD_ACTIONS: KeywordAction[] = [
  {
    keyword: "ultrawork",
    injection: `[ULTRAWORK MODE ACTIVATED]
Maximum effort engaged. Use ALL available agents in parallel. No shortcuts. Complete the task fully and deeply before responding.`,
  },
  {
    keyword: "ulw",
    injection: `[ULTRAWORK MODE ACTIVATED]
Maximum effort engaged. Use ALL available agents in parallel. No shortcuts. Complete the task fully and deeply before responding.`,
  },
]

export function detectKeywords(
  message: string,
  actions: KeywordAction[] = DEFAULT_KEYWORD_ACTIONS,
): KeywordAction[] {
  const lower = message.toLowerCase()
  return actions.filter((a) => lower.includes(a.keyword.toLowerCase()))
}

export function buildKeywordInjection(detected: KeywordAction[]): string | undefined {
  if (detected.length === 0) return undefined
  return detected.map((a) => a.injection).join("\n\n")
}

export function processMessageForKeywords(
  message: string,
  sessionId: string,
  actions?: KeywordAction[],
): string | undefined {
  const detected = detectKeywords(message, actions)
  if (detected.length > 0) {
    log(`[keyword-detector] Detected keywords in session ${sessionId}: ${detected.map((a) => a.keyword).join(", ")}`)
  }
  return buildKeywordInjection(detected)
}
