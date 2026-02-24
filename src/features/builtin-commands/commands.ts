import type { BuiltinCommand, BuiltinCommandName } from "./types"
import { START_WORK_TEMPLATE } from "./templates/start-work"

export const BUILTIN_COMMANDS: Record<BuiltinCommandName, BuiltinCommand> = {
  "start-work": {
    name: "start-work",
    description: "Start executing a Weave plan created by Pattern",
    template: `<command-instruction>
${START_WORK_TEMPLATE}
</command-instruction>
<session-context>Session ID: $SESSION_ID  Timestamp: $TIMESTAMP</session-context>
<user-request>$ARGUMENTS</user-request>`,
    argumentHint: "[plan-name]",
  },
}
