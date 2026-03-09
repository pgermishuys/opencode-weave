import type { BuiltinCommand, BuiltinCommandName } from "./types"
import { START_WORK_TEMPLATE } from "./templates/start-work"
import { METRICS_TEMPLATE } from "./templates/metrics"

export const BUILTIN_COMMANDS: Record<BuiltinCommandName, BuiltinCommand> = {
  "start-work": {
    name: "start-work",
    description: "Start executing a Weave plan created by Pattern",
    agent: "tapestry",
    template: `<command-instruction>
${START_WORK_TEMPLATE}
</command-instruction>
<session-context>Session ID: $SESSION_ID  Timestamp: $TIMESTAMP</session-context>
<user-request>$ARGUMENTS</user-request>`,
    argumentHint: "[plan-name]",
  },
  "token-report": {
    name: "token-report",
    description: "Show token usage and cost report across sessions",
    agent: "loom",
    template: `<command-instruction>
Display the token usage report that has been injected below. Present it clearly to the user.
</command-instruction>
<token-report>$ARGUMENTS</token-report>`,
  },
  "metrics": {
    name: "metrics",
    description: "Show Weave analytics and plan metrics reports",
    agent: "loom",
    template: `<command-instruction>
${METRICS_TEMPLATE}
</command-instruction>
<metrics-data>$ARGUMENTS</metrics-data>`,
    argumentHint: "[plan-name|all]",
  },
}
