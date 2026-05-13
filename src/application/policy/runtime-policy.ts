import type { CreatedHooks } from "../../hooks/create-hooks"
import type { ParsedCommandEnvelope } from "../../runtime/opencode/command-envelope"
import type { RuntimeEffect } from "../../runtime/opencode/effects"
import type { TrustedInjectedPromptKind } from "../../runtime/opencode/trusted-message-state"

export interface RuntimePolicyFlags {
  contextWindowThresholds: { warningPct: number; criticalPct: number } | null
  rulesInjectorEnabled: boolean
  patternMdOnlyEnabled: boolean
  verificationReminderEnabled: boolean
  todoDescriptionOverrideEnabled: boolean
  todoContinuationEnforcerEnabled: boolean
}

export interface RuntimeChatMessageInput {
  directory: string
  sessionId: string
  promptText: string
  parsedEnvelope: ParsedCommandEnvelope | null
  hooks: RuntimePolicyFlags & Pick<CreatedHooks, "startWork" | "workflowStart" | "workflowCommand" | "continuation">
}

export interface RuntimeBeforeToolInput {
  directory: string
  sessionId: string
  tool: string
  callId: string
  hooks: RuntimePolicyFlags & Pick<CreatedHooks, "writeGuard">
  agent?: string
  toolArgs?: Record<string, unknown> | null
}

export interface RuntimeAfterToolInput {
  directory: string
  sessionId: string
  tool: string
  callId: string
  hooks: RuntimePolicyFlags
  agent?: string
  toolArgs?: Record<string, unknown> | null
}

export interface RuntimeSessionIdleInput {
  directory: string
  sessionId: string
  hooks: RuntimePolicyFlags & Pick<CreatedHooks, "continuation" | "workContinuation" | "workflowContinuation">
  lastAssistantMessage?: string
  lastUserMessage?: string
}

export interface RuntimeSessionDeletedInput {
  directory: string
  sessionId: string
  hooks: RuntimePolicyFlags
}

export interface RuntimeCompactionInput {
  directory: string
  sessionId: string
  hooks: RuntimePolicyFlags & Pick<CreatedHooks, "continuation" | "compactionRecovery">
  enabledAgents?: ReadonlySet<string>
}

export interface RuntimeBeforeCompactionInput {
  directory: string
  sessionId: string
  hooks: RuntimePolicyFlags
}

export interface RuntimeAssistantMessageInput {
  directory: string
  sessionId: string
  hooks: RuntimePolicyFlags
  inputTokens: number
  foregroundAgent?: string | null
  assistantText?: string
  originalPromptText?: string
  respondingToTrustedInjectedPromptKind?: TrustedInjectedPromptKind | null
  messageId?: string
}

export interface RuntimeToolDefinitionInput {
  toolId: string
  hooks: RuntimePolicyFlags
  output: {
    description: string
    parameters?: unknown
  }
}

export interface RuntimeLifecyclePolicySurface {
  onChatMessage(input: RuntimeChatMessageInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  beforeTool(input: RuntimeBeforeToolInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  afterTool(input: RuntimeAfterToolInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  onToolDefinition(input: RuntimeToolDefinitionInput): void | Promise<void>
  onAssistantMessage(input: RuntimeAssistantMessageInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  onSessionIdle(input: RuntimeSessionIdleInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  onSessionDeleted(input: RuntimeSessionDeletedInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
  beforeCompaction(input: RuntimeBeforeCompactionInput): void | Promise<void>
  onCompaction(input: RuntimeCompactionInput): RuntimeEffect[] | Promise<RuntimeEffect[]>
}
