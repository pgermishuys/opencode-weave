/**
 * A built-in command that can be invoked via /command-name in the chat.
 */
export interface BuiltinCommand {
  /** Human-readable description shown in command list */
  description: string
  /** Agent to switch to when this command is executed */
  agent: string
  /** Prompt template with $SESSION_ID, $TIMESTAMP, $ARGUMENTS placeholders */
  template: string
  /** Hint shown for the argument (e.g., "[plan-name]") */
  argumentHint?: string
}

export type BuiltinCommandName = "start-work"
