export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR") {
    return value
  }
  return "INFO"
}

let activeLevel: LogLevel = parseLogLevel(process.env.WEAVE_LOG_LEVEL)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: { app: { log: (opts?: any) => Promise<unknown> } } | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setClient(c: { app: { log: (opts?: any) => Promise<unknown> } } | null): void {
  client = c
}

export function setLogLevel(level: LogLevel): void {
  activeLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[activeLevel]
}

function emit(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRef = (client as any)?.app
  if (appRef && typeof appRef.log === "function") {
    const extra =
      data !== undefined
        ? typeof data === "object" && data !== null
          ? (data as Record<string, unknown>)
          : { value: data }
        : undefined
    // Call log as a method on app to preserve `this` binding (the SDK's
    // generated classes access `this._client` internally).
    appRef.log(
      { body: { service: "weave", level: level.toLowerCase(), message, extra } },
    ).catch(() => {})
  } else {
    if (level === "ERROR" || level === "WARN") {
      console.error(`[weave:${level}] ${message}`, data ?? "")
    }
    // DEBUG and INFO are silently dropped before client is set
  }
}

export function debug(message: string, data?: unknown): void {
  emit("DEBUG", message, data)
}

export function info(message: string, data?: unknown): void {
  emit("INFO", message, data)
}

export function warn(message: string, data?: unknown): void {
  emit("WARN", message, data)
}

export function error(message: string, data?: unknown): void {
  emit("ERROR", message, data)
}

export function log(message: string, data?: unknown): void {
  info(message, data)
}

export interface DelegationEvent {
  phase: "start" | "complete" | "error"
  agent: string
  sessionId?: string
  toolCallId?: string
  durationMs?: number
  summary?: string
}

export function logDelegation(event: DelegationEvent): void {
  const prefix = `[delegation:${event.phase}]`
  log(`${prefix} agent=${event.agent}`, {
    sessionId: event.sessionId,
    toolCallId: event.toolCallId,
    durationMs: event.durationMs,
    summary: event.summary,
  })
}
