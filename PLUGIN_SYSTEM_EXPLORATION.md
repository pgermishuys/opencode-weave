# OpenCode Plugin System & Hook Lifecycle Exploration Report

## Executive Summary

A plugin **CANNOT** trigger an agent switch AFTER a message completes using the current OpenCode plugin system. The `chat.message` hook fires on USER messages only (not assistant completion), and there is **no hook that fires after an ASSISTANT message finishes**.

To enable post-completion agent switching (Tapestry → Loom), the OpenCode core would need to:
1. Add a new `message.completed` or `assistant.done` hook
2. Trigger it AFTER `SessionProcessor` finishes and `Session.updateMessage()` is called
3. Allow that hook to modify `message.agent` before the loop continues

---

## 1. PLUGIN INTERFACE & AVAILABLE HOOKS

**File:** `/Users/pgermishuys/source/opencode/packages/plugin/src/index.ts` (lines 148-234)

### Hooks Interface Definition

```typescript
export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook
  
  // USER MESSAGE HOOKS
  "chat.message"?: (
    input: { sessionID: string; agent?: string; model?: {...}; messageID?: string; variant?: string },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  
  // LLM PARAMETER HOOKS
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  
  // PERMISSION & COMMAND HOOKS
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  
  // TOOL EXECUTION HOOKS
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>
  
  // ENVIRONMENT & SYSTEM HOOKS
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  
  // EXPERIMENTAL HOOKS
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message; parts: Part[] }[] },
  ) => Promise<void>
  
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>
  
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  
  // TOOL DEFINITION HOOKS
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
}
```

### Hook Trigger Mechanism

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/plugin/index.ts` (lines 106-121)

```typescript
export async function trigger<
  Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
  Input = Parameters<Required<Hooks>[Name]>[0],
  Output = Parameters<Required<Hooks>[Name]>[1],
>(name: Name, input: Input, output: Output): Promise<Output> {
  if (!name) return output
  for (const hook of await state().then((x) => x.hooks)) {
    const fn = hook[name]
    if (!fn) continue
    await fn(input, output)
  }
  return output
}
```

**Key Point:** `Plugin.trigger()` modifies the `output` object **in-place**. Plugins can mutate output properties and those mutations will be seen by the caller.

---

## 2. HOOK RETURN TYPES & MUTATION PATTERNS

Unlike typical event systems, OpenCode hooks use an **input/output pattern** where:

- **Input:** Read-only context about what's happening
- **Output:** Mutable object that plugins can modify
- **Return:** Always `Promise<void>` (no explicit return value)

### Key Example: `chat.message` Hook

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 1295-1308)

```typescript
await Plugin.trigger(
  "chat.message",
  {
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.model,
    messageID: input.messageID,
    variant: input.variant,
  },
  {
    message: info,        // UserMessage object
    parts,                // Part[] array
  },
)

// After hook returns, output mutations are applied:
await Session.updateMessage(info)
for (const part of parts) {
  await Session.updatePart(part)
}
```

### Agent Switch via `chat.message` (Weave Example)

**File:** `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 88-93)

```typescript
const result = hooks.startWork(promptText, sessionID)

// Switch agent by mutating output.message.agent (OpenCode reads this to route the message)
if (result.switchAgent && message) {
  message.agent = getAgentDisplayName(result.switchAgent)
}
```

**This works because:**
1. The hook receives the message object in the output parameter
2. It mutates `message.agent` directly
3. The mutation persists because it's the same object reference

---

## 3. EVENT SYSTEM - Message & Session Events

### Session-Level Events

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/index.ts` (lines 177-210)

```typescript
export const Event = {
  Created: BusEvent.define(
    "session.created",
    z.object({ info: Info }),
  ),
  Updated: BusEvent.define(
    "session.updated",
    z.object({ info: Info }),
  ),
  Deleted: BusEvent.define(
    "session.deleted",
    z.object({ info: Info }),
  ),
  Diff: BusEvent.define(
    "session.diff",
    z.object({ sessionID: z.string(); diff: Snapshot.FileDiff.array() }),
  ),
  Error: BusEvent.define(
    "session.error",
    z.object({
      sessionID: z.string().optional();
      error: MessageV2.Assistant.shape.error,
    }),
  ),
}
```

### Message-Level Events

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/message-v2.ts` (lines 445-483)

```typescript
export const Event = {
  Updated: BusEvent.define(
    "message.updated",
    z.object({ info: Info }),
  ),
  Removed: BusEvent.define(
    "message.removed",
    z.object({ sessionID: z.string(); messageID: z.string() }),
  ),
  PartUpdated: BusEvent.define(
    "message.part.updated",
    z.object({ part: Part }),
  ),
  PartDelta: BusEvent.define(
    "message.part.delta",
    z.object({
      sessionID: z.string();
      messageID: z.string();
      partID: z.string();
      field: z.string();
      delta: z.string();
    }),
  ),
  PartRemoved: BusEvent.define(
    "message.part.removed",
    z.object({
      sessionID: z.string();
      messageID: z.string();
      partID: z.string();
    }),
  ),
}
```

### How Events are Consumed by Plugins

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/plugin/index.ts` (lines 127-142)

```typescript
export async function init() {
  const hooks = await state().then((x) => x.hooks)
  const config = await Config.get()
  for (const hook of hooks) {
    await hook.config?.(config)
  }
  Bus.subscribeAll(async (input) => {
    const hooks = await state().then((x) => x.hooks)
    for (const hook of hooks) {
      hook["event"]?.({ event: input })
    }
  })
}
```

**Important:** Events are published AFTER changes are persisted. A plugin receives a `message.updated` event AFTER the message is already saved.

### When `message.updated` Fires for Assistant Messages

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/processor.ts` (lines 410-411)

```typescript
input.assistantMessage.time.completed = Date.now()
await Session.updateMessage(input.assistantMessage)
// ↑ This triggers Bus.publish(MessageV2.Event.Updated, { info: assistantMessage })
```

This happens AFTER the assistant message is fully processed. However:
- The event hook cannot modify the message (it's immutable by the time the event fires)
- The event hook cannot switch agents for this message (it's already complete)
- The loop continues automatically based on finish reason, not via plugin control

---

## 4. PLUGIN REGISTRATION & LOADING

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/plugin/index.ts` (lines 16-104)

```typescript
const BUILTIN = ["opencode-anthropic-auth@0.0.13"]
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin]

const state = Instance.state(async () => {
  const client = createOpencodeClient({ ... })
  const config = await Config.get()
  const hooks: Hooks[] = []
  const input: PluginInput = { ... }

  // Load internal plugins (hard-coded)
  for (const plugin of INTERNAL_PLUGINS) {
    const init = await plugin(input).catch((err) => { ... })
    if (init) hooks.push(init)
  }

  // Load external plugins
  let plugins = config.plugin ?? []
  if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
    plugins = [...BUILTIN, ...plugins]
  }

  for (let plugin of plugins) {
    // Load from npm or file:// URL
    const mod = await import(plugin).then(async (mod) => {
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        hooks.push(await fn(input))
      }
    })
  }

  return { hooks, input }
})
```

### Plugin Contract

A plugin is a function that matches the `Plugin` type:

```typescript
export type Plugin = (input: PluginInput) => Promise<Hooks>

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}
```

---

## 5. SESSION TURN LOOP & AGENT SWITCHING LOGIC

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 274-724)

The main turn loop structure:

```typescript
export const loop = fn(LoopInput, async (input) => {
  let step = 0
  const session = await Session.get(sessionID)
  
  while (true) {
    // 1. Get latest messages
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
    
    // 2. Extract lastUser and lastAssistant messages
    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    // ... find these ...
    
    // 3. Check if assistant message already finished
    if (lastAssistant?.finish && lastUser.id < lastAssistant.id) {
      log.info("exiting loop", { sessionID })
      break  // ← Exit here
    }
    
    // 4. Create new assistant message with lastUser.agent
    const agent = await Agent.get(lastUser.agent)  // ← Agent determined by LAST USER message
    
    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
        agent: agent.name,  // ← Agent is set here, from user message
        // ...
      })) as MessageV2.Assistant,
      // ...
    })
    
    // 5. Run the LLM
    const result = await processor.process({ ... })
    
    // 6. Continue to next iteration based on result
    if (result === "stop") break
    if (result === "compact") {
      await SessionCompaction.create({ ... })
    }
    continue  // ← Loop continues if not stop/break
  }
})
```

### The Key Problem

**The agent for the next assistant message is determined at line 557:**

```typescript
const agent = await Agent.get(lastUser.agent)
```

The agent comes from **the last USER message**, not from plugin control.

**After the assistant message finishes processing:**
- `processor.process()` returns (line 657)
- The assistant message is fully saved (line 411 in processor.ts)
- `message.updated` event fires (but mutation too late)
- Loop checks `result` (stop/compact/continue)
- If continue: loop goes back to line 298 and does it all again
- **Agent for next message is still determined by `lastUser.agent`**

**There is NO hook that fires between processor completion and the next iteration.**

---

## 6. CHAT.MESSAGE HOOK - Current Agent Switching Capability

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 1295-1310)

The `chat.message` hook is the ONLY way to switch agents via plugin, but:

```typescript
// This hook fires for USER messages only
await Plugin.trigger(
  "chat.message",
  {
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.model,
    messageID: input.messageID,
    variant: input.variant,
  },
  {
    message: info,  // This is a UserMessage
    parts,
  },
)
```

### How Weave Uses It for Agent Switching

**File:** `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 48-106)

```typescript
"chat.message": async (input, _output) => {
  const { sessionID } = input
  
  if (hooks.startWork) {
    const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
    const message = (_output as Record<string, unknown>).message as Record<string, unknown> | undefined

    const result = hooks.startWork(promptText, sessionID)

    // Switch agent by mutating output.message.agent
    if (result.switchAgent && message) {
      message.agent = getAgentDisplayName(result.switchAgent)
    }
    
    // Also inject context
    if (result.contextInjection && parts) {
      const idx = parts.findIndex((p) => p.type === "text" && p.text)
      if (idx >= 0 && parts[idx].text) {
        parts[idx].text += `\n\n---\n${result.contextInjection}`
      }
    }
  }
}
```

**This only works for:**
- USER messages (where `chat.message` fires)
- Immediate agent switching on the same user message
- NOT for post-completion agent switching

---

## 7. EXPERIMENTAL TEXT COMPLETION HOOK

**File:** `/Users/pgermishuys/source/opencode/packages/opencode/src/session/processor.ts` (lines 316-337)

```typescript
case "text-end":
  if (currentText) {
    currentText.text = currentText.text.trimEnd()
    const textOutput = await Plugin.trigger(
      "experimental.text.complete",
      {
        sessionID: input.sessionID,
        messageID: input.assistantMessage.id,
        partID: currentText.id,
      },
      { text: currentText.text },
    )
    currentText.text = textOutput.text
    // ...
  }
  break
```

This hook:
- Fires DURING assistant message processing (when text completes)
- Only modifies text content
- Cannot switch agents
- Cannot stop the message from completing

---

## 8. WEAVE PLUGIN INTERFACE - Current Hooks

**File:** `/Users/pgermishuys/source/weave/src/plugin/plugin-interface.ts` (lines 16-290)

Weave implements these hooks:

```typescript
tool: tools,
config: async (config) => { /* register agents/commands */ },
"chat.message": async (input, output) => { /* start-work, plan resolution */ },
"chat.params": async (_input, output) => { /* capture context limit */ },
"chat.headers": async (...) => { /* pass-through */ },
event: async (input) => { /* handle events */ },
"tool.execute.before": async (...) => { /* tool execution hooks */ },
"tool.execute.after": async (...) => { /* delegation logging */ },
```

Notably:
- Weave handles `session.idle` event (line 182) for work continuation
- But there's NO hook for post-completion agent switching
- Events fire AFTER changes are saved (too late to modify)

---

## CONCLUSION: CAN A PLUGIN SWITCH AGENTS POST-COMPLETION?

### Current Answer: **NO**

There is **no mechanism** for a plugin to trigger an agent switch AFTER an assistant message (e.g., Tapestry) finishes.

### Why Not?

1. **`chat.message` hook** - Only fires on USER messages, not assistant completion
2. **`message.updated` event** - Fires after message is saved; too late to modify
3. **No post-completion hook** - No hook exists that fires after `SessionProcessor.process()` returns and before the loop continues
4. **Loop control** - Agent for next message is hard-wired to `lastUser.agent` at line 557 in prompt.ts

### To Enable Post-Completion Agent Switching

OpenCode would need to:

1. **Add a new hook** (e.g., `"message.completed"`) that fires after an assistant message finishes but BEFORE the loop continues

2. **Fire it after processor.process() returns**, like:

```typescript
const result = await processor.process({ ... })

// NEW HOOK - fire here, BEFORE checking finish reason
await Plugin.trigger(
  "message.completed",
  {
    sessionID,
    messageID: processor.message.id,
    agentName: processor.message.agent,
    finishReason: processor.message.finish,
  },
  {
    nextAgent: processor.message.agent,  // Plugin can mutate this
  },
)

// Apply the agent switch
if (result.nextAgent !== processor.message.agent) {
  // Create synthetic user message with new agent?
  // Or modify loop to use result.nextAgent instead of lastUser.agent?
}
```

3. **Allow plugin to specify next agent** via mutation of the output object

4. **Update the loop logic** to use the plugin-provided agent instead of `lastUser.agent`

This would enable Tapestry to finish its work, then Weave/Loom orchestration could detect the completion via a hook and switch to the appropriate next agent.

---

## RELEVANT FILE LOCATIONS

| Concern | File | Lines |
|---------|------|-------|
| Hook Types & Interface | `/opencode/packages/plugin/src/index.ts` | 148-234 |
| Plugin Trigger Mechanism | `/opencode/packages/opencode/src/plugin/index.ts` | 106-121 |
| Plugin Loading | `/opencode/packages/opencode/src/plugin/index.ts` | 24-104 |
| Session Events | `/opencode/packages/opencode/src/session/index.ts` | 177-210 |
| Message Events | `/opencode/packages/opencode/src/session/message-v2.ts` | 445-483 |
| chat.message Hook Trigger | `/opencode/packages/opencode/src/session/prompt.ts` | 1295-1310 |
| Main Loop & Agent Selection | `/opencode/packages/opencode/src/session/prompt.ts` | 274-724 |
| Processor Message Completion | `/opencode/packages/opencode/src/session/processor.ts` | 410-416 |
| Weave Plugin Implementation | `/weave/src/plugin/plugin-interface.ts` | 1-290 |
| Weave Plugin Types | `/weave/src/plugin/types.ts` | 1-20 |

