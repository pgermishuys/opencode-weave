import { BUILTIN_COMMANDS } from "../../features/builtin-commands/commands"
import type { BuiltinCommandEnvelopeName } from "./protocol"
import { parseCommandEnvelope, type ParsedCommandEnvelope } from "./command-envelope"

interface PendingBuiltinCommand {
  command: BuiltinCommandEnvelopeName
  argumentsText: string
  issuedAt: number
}

export type TrustedInjectedPromptKind = "generic" | "reviewer-fanout"

export interface TrustedInjectedPromptMetadata {
  kind: TrustedInjectedPromptKind
  nonce?: string
}

interface PendingInjectedPrompt {
  text: string
  metadata: TrustedInjectedPromptMetadata
}

export interface TrustedMessageState {
  registerBuiltinCommand(sessionId: string, command: BuiltinCommandEnvelopeName, argumentsText: string): void
  registerInjectedPrompt(sessionId: string, text: string, metadata?: TrustedInjectedPromptMetadata): void
  consumeInjectedPrompt(sessionId: string, promptText: string): TrustedInjectedPromptMetadata | null
  clearSession(sessionId: string): void
  clearPendingBuiltin(sessionId: string): void
  consumeTrustedEnvelope(sessionId: string, promptText: string): ParsedCommandEnvelope | null
}

export function createTrustedMessageState(): TrustedMessageState {
  const pendingBuiltinCommands = new Map<string, PendingBuiltinCommand[]>()
  const pendingInjectedPrompts = new Map<string, PendingInjectedPrompt[]>()

  return {
    registerBuiltinCommand(sessionId, command, argumentsText) {
      const current = pendingBuiltinCommands.get(sessionId) ?? []
      current.push({ command, argumentsText: normalize(argumentsText), issuedAt: Date.now() })
      pendingBuiltinCommands.set(sessionId, current)
    },
    registerInjectedPrompt(sessionId, text, metadata) {
      addTrustedText(pendingInjectedPrompts, sessionId, text, metadata)
    },
    consumeInjectedPrompt(sessionId, promptText) {
      const current = pendingInjectedPrompts.get(sessionId) ?? []
      const matchedIndex = current.findIndex((candidate) => candidate.text === promptText)
      if (matchedIndex < 0) {
        return null
      }

      const [matched] = current.splice(matchedIndex, 1)
      if (current.length === 0) {
        pendingInjectedPrompts.delete(sessionId)
      }

      return matched?.metadata ?? null
    },
    clearSession(sessionId) {
      pendingBuiltinCommands.delete(sessionId)
      pendingInjectedPrompts.delete(sessionId)
    },
    clearPendingBuiltin(sessionId) {
      pendingBuiltinCommands.delete(sessionId)
    },
    consumeTrustedEnvelope(sessionId, promptText) {
      const parsedEnvelope = parseCommandEnvelope(promptText)
      if (!parsedEnvelope) {
        return null
      }

      if (parsedEnvelope.kind === "builtin-command") {
        const current = pendingBuiltinCommands.get(sessionId) ?? []
        const candidate = current[0]
        const matchedIndex = candidate
          && candidate.command === parsedEnvelope.command
          && candidate.argumentsText === normalize(parsedEnvelope.arguments)
          && parsedEnvelope.sessionId === sessionId
          && isTrustedTimestamp(parsedEnvelope.timestamp, candidate.issuedAt)
          && normalizePrompt(promptText) === renderExpectedBuiltinPrompt(parsedEnvelope)
          ? 0
          : -1

        pendingBuiltinCommands.delete(sessionId)

        if (matchedIndex < 0) {
          return null
        }

        return parsedEnvelope
      }

      const matchedMetadata = this.consumeInjectedPrompt(sessionId, promptText)
      if (!matchedMetadata) {
        return null
      }

      return parsedEnvelope
    },
  }
}

function normalize(value: string): string {
  return value.trim()
}

function addTrustedText(
  store: Map<string, PendingInjectedPrompt[]>,
  sessionId: string,
  text: string,
  metadata?: TrustedInjectedPromptMetadata,
): void {
  const normalizedMetadata: TrustedInjectedPromptMetadata = metadata ?? { kind: "generic" }
  const current = store.get(sessionId) ?? []

  if (normalizedMetadata.kind === "generic" && current.some((entry) => entry.text === text)) {
    return
  }

  const existingGeneric = current.find((entry) => entry.text === text && entry.metadata.kind === "generic")
  if (existingGeneric && normalizedMetadata.kind === "reviewer-fanout") {
    existingGeneric.metadata = normalizedMetadata
    return
  }

  const duplicate = current.some((entry) => entry.text === text && isSameTrustedMetadata(entry.metadata, normalizedMetadata))
  if (duplicate) {
    return
  }

  current.push({ text, metadata: normalizedMetadata })
  store.set(sessionId, current)
}

function isSameTrustedMetadata(left: TrustedInjectedPromptMetadata, right: TrustedInjectedPromptMetadata): boolean {
  return left.kind === right.kind && left.nonce === right.nonce
}

function renderExpectedBuiltinPrompt(input: Extract<ParsedCommandEnvelope, { kind: "builtin-command" }>): string {
  return normalizePrompt(
    BUILTIN_COMMANDS[input.command].template
      .replace(/\$SESSION_ID/g, input.sessionId ?? "")
      .replace(/\$TIMESTAMP/g, input.timestamp ?? "")
      .replace(/\$ARGUMENTS/g, input.arguments),
  )
}

function normalizePrompt(value: string): string {
  return value.trim()
}

function isTrustedTimestamp(timestamp: string | null | undefined, issuedAt: number): boolean {
  if (!timestamp) {
    return false
  }

  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    return false
  }

  return Math.abs(parsed - issuedAt) <= 60_000
}
