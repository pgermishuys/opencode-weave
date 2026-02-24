/**
 * A built-in command that can be invoked via /command-name in the chat.
 */
export interface BuiltinCommand {
  /** Command name matching the key in BUILTIN_COMMANDS (e.g., "start-work") */
  name: string
  /** Human-readable description shown in command list */
  description: string
  /** Agent to switch to when this command is executed (omit to stay on current agent) */
  agent?: string
  /** Prompt template with $SESSION_ID, $TIMESTAMP, $ARGUMENTS placeholders */
  template: string
  /** Hint shown for the argument (e.g., "[plan-name]") */
  argumentHint?: string
}

export type BuiltinCommandName = "start-work"
