# OpenCode Plugin System - Quick Reference

## Can a Plugin Switch Agents AFTER a Message Completes?

**Answer: NO** ❌

## Why?

### Current Hook Timeline

```
USER SENDS MESSAGE
    ↓
[chat.message hook fires] ← Agent can be switched HERE
    ↓
ASSISTANT PROCESSES (LLM calls, tools, etc.)
    ↓
ASSISTANT MESSAGE COMPLETE
    ↓
[message.updated event fires] ← Too late, message already saved
    ↓
LOOP CONTINUES (back to processing next turn)
```

**The problem:** No hook fires after assistant completion but before loop continuation.

## All Available Hooks

| Hook | Fires When | Agent Switch? | Mutation |
|------|-----------|---------------|----------|
| `chat.message` | User message received | ✅ YES (set `message.agent`) | Output object |
| `chat.params` | LLM request about to be sent | ❌ NO | Output object |
| `chat.headers` | LLM request headers | ❌ NO | Output object |
| `permission.ask` | Permission check needed | ❌ NO | Output object |
| `command.execute.before` | Command about to run | ❌ NO | Output object |
| `tool.execute.before` | Tool about to execute | ❌ NO | Output object |
| `tool.execute.after` | Tool finished executing | ❌ NO | Output object |
| `shell.env` | Shell environment setup | ❌ NO | Output object |
| `experimental.chat.messages.transform` | Before LLM call | ❌ NO | Messages array |
| `experimental.chat.system.transform` | Before LLM call | ❌ NO | System prompt |
| `experimental.session.compacting` | Session compaction | ❌ NO | Context/prompt |
| `experimental.text.complete` | Text chunk finished | ❌ NO (mid-processing) | Text content |
| `tool.definition` | Tool schema requested | ❌ NO | Tool definition |
| `event` | Session/message event | ❌ NO | Read-only |

## How to Switch Agents (Currently)

### Via `chat.message` Hook (User Side)

```typescript
"chat.message": async (input, output) => {
  // output.message is a UserMessage object
  // Mutate it directly:
  output.message.agent = "loom"  // Switch on this user message
}
```

This determines which agent processes the **next** assistant message.

### Example: Weave Implementation

```typescript
// In weave/src/plugin/plugin-interface.ts
"chat.message": async (input, _output) => {
  const message = (_output.message as any)
  const result = hooks.startWork(promptText, sessionID)
  
  if (result.switchAgent && message) {
    message.agent = getAgentDisplayName(result.switchAgent)
  }
}
```

## What Would Be Needed for Post-Completion Switch

1. **New Hook:** `message.completed` or `assistant.done`
   
2. **Fire Point:** In `/opencode/packages/opencode/src/session/prompt.ts` after line 657:
   ```typescript
   const result = await processor.process({ ... })
   
   // NEW: Fire completion hook BEFORE checking finish reason
   await Plugin.trigger(
     "message.completed",
     { sessionID, messageID: processor.message.id, agent: processor.message.agent, finish: processor.message.finish },
     { nextAgent: processor.message.agent }  // Plugin can mutate this
   )
   ```

3. **Loop Update:** Use `nextAgent` instead of `lastUser.agent` for next iteration

4. **Message Creation:** Either:
   - Create synthetic user message with new agent, OR
   - Inject agent switch decision directly in loop

## Key Files

| What | File | Lines |
|------|------|-------|
| Hook Types | `/opencode/packages/plugin/src/index.ts` | 148-234 |
| Hook Trigger | `/opencode/packages/opencode/src/plugin/index.ts` | 106-121 |
| Main Loop | `/opencode/packages/opencode/src/session/prompt.ts` | 274-724 |
| Agent Selection | `/opencode/packages/opencode/src/session/prompt.ts` | 557 |
| Processor Finish | `/opencode/packages/opencode/src/session/processor.ts` | 410-416 |

## Plugin Registration

Plugins are loaded via:
1. **Built-in:** Hardcoded in code (e.g., Copilot auth)
2. **Config:** Listed in `.opencode/opencode.json` → `config.plugin`
3. **npm:** Auto-installed from npm registry
4. **Local:** Via `file://` URLs

Each plugin is a function:
```typescript
export type Plugin = (input: PluginInput) => Promise<Hooks>
```

## Limitations

- Hooks use **mutation** not return values
- Events fire **after** changes are saved (read-only)
- Agent determined by **last user message** (immutable after user sends it)
- No way to trigger turn completion → next agent switch as a chain
