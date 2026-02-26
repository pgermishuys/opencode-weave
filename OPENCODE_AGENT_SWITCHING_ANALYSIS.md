# OpenCode Agent Switching Framework Analysis

## Executive Summary

OpenCode uses a **per-message agent selection system** rather than per-session agent state. Each user message explicitly specifies which agent should handle it. The agent is:
1. Selected by the UI (stored in `local.agent.current()`)
2. Sent with every message request (in `PromptInput.agent` or `CommandInput.agent`)
3. Resolved at message creation time to determine permissions and behavior
4. Persisted with the message so assistant responses know which agent served them
5. **Cannot be changed programmatically between turns** - agent switching is UI-driven only

---

## 1. Agent Selection Per Message

### Where `message.agent` is Read and Used

#### A. Message Creation - `packages/opencode/src/session/prompt.ts` (lines 954-977)

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts`

```typescript
// Line 954-977: createUserMessage function
async function createUserMessage(input: PromptInput) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
  
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const full = !input.variant && agent.variant
    ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
    : undefined
  const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)
  
  const info: MessageV2.Info = {
    id: input.messageID ?? Identifier.ascending("message"),
    role: "user",
    sessionID: input.sessionID,
    time: { created: Date.now() },
    tools: input.tools,
    agent: agent.name,        // <-- Agent name stored with message
    model,
    system: input.system,
    format: input.format,
    variant,
  }
  // ...
}
```

**Key insight**: The agent name is resolved ONCE at message creation and stored permanently with the message record.

#### B. Message Schema Definition - `packages/opencode/src/session/message-v2.ts` (lines 345-369)

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/message-v2.ts`

```typescript
// Lines 345-369: User message schema
export const User = Base.extend({
  role: z.literal("user"),
  time: z.object({
    created: z.number(),
  }),
  format: Format.optional(),
  summary: z.object({
    title: z.string().optional(),
    body: z.string().optional(),
    diffs: Snapshot.FileDiff.array(),
  }).optional(),
  agent: z.string(),           // <-- Agent name is a STRING field
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }),
  system: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  variant: z.string().optional(),
})
export type User = z.infer<typeof User>
```

**Assistant message also has agent field** (lines 391-415):

```typescript
export const Assistant = Base.extend({
  role: z.literal("assistant"),
  // ... other fields ...
  agent: z.string(),           // <-- Assistant also records which agent handled it
  // ...
})
```

#### C. PromptInput Schema - `packages/opencode/src/session/prompt.ts` (lines 100-156)

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts`

```typescript
// Lines 100-156: PromptInput schema definition
export const PromptInput = z.object({
  sessionID: Identifier.schema("session"),
  messageID: Identifier.schema("message").optional(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  agent: z.string().optional(),        // <-- Optional agent field
  noReply: z.boolean().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  // ... other fields ...
  parts: z.array(/* part definitions */),
})
export type PromptInput = z.infer<typeof PromptInput>
```

---

## 2. Agent Switching Mechanism

### UI-Driven Agent Selection

**File**: `/Users/pgermishuys/source/opencode/packages/app/src/components/prompt-input/submit.ts` (lines 115-220)

```typescript
// Lines 129-130: Get current agent from UI state
const currentModel = local.model.current()
const currentAgent = local.agent.current()
if (!currentModel || !currentAgent) {
  // Show error
  return
}

// Line 218: Extract agent name
const agent = currentAgent.name

// Lines 392-399: Send to server with agent specified
await client.session.promptAsync({
  sessionID: session.id,
  agent,          // <-- Current agent sent with request
  model,
  messageID,
  parts: requestParts,
  variant,
})
```

### Agent Selection Hierarchy

When `PromptInput.agent` is specified, resolution order is:

1. **Explicit input**: `input.agent` (provided by UI)
2. **Default agent**: `await Agent.defaultAgent()` (fallback)

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (line 955)

```typescript
const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
```

---

## 3. Session State Management

### No "Current Agent" Maintained in Session

OpenCode **does NOT** maintain a current/active agent per session. Evidence:

**Session Info schema** - `packages/opencode/src/session/index.ts`:
- Session stores only basic metadata (id, directory, title, etc.)
- **No agent field in Session.Info type**
- No session-level agent state

### Per-Message Agent is the Source of Truth

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/server/routes/session.ts` (lines 520-528)

When compacting a session, the last user message's agent is retrieved:

```typescript
const msgs = await Session.messages({ sessionID })
let currentAgent = await Agent.defaultAgent()
for (let i = msgs.length - 1; i >= 0; i--) {
  const info = msgs[i].info
  if (info.role === "user") {
    currentAgent = info.agent || (await Agent.defaultAgent())  // <-- Last user message's agent
    break
  }
}
```

**Key finding**: The framework doesn't track "which agent is currently handling this session" - it only looks at which agent handled the most recent user message.

---

## 4. Message Routing

### The Main Processing Loop: `SessionPrompt.loop()`

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 274-723)

The loop runs after a user message is created and:

1. **Retrieves the last user message** (lines 300-315)
2. **Gets the agent for that message** (line 557)
3. **Uses that agent to determine behavior**

```typescript
// Line 557: Get agent from last user message
const agent = await Agent.get(lastUser.agent)

// Line 558: Use agent to determine max steps
const maxSteps = agent.steps ?? Infinity

// Lines 566-595: Create assistant message with same agent
const processor = SessionProcessor.create({
  assistantMessage: (await Session.updateMessage({
    id: Identifier.ascending("message"),
    parentID: lastUser.id,
    role: "assistant",
    mode: agent.name,
    agent: agent.name,      // <-- Assistant gets same agent name
    // ...
  })) as MessageV2.Assistant,
  // ...
})
```

### LLM Invocation Uses Agent Configuration

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/llm.ts` (lines 46-79)

```typescript
export async function stream(input: StreamInput) {
  const l = log
    .clone()
    .tag("providerID", input.model.providerID)
    .tag("modelID", input.model.id)
    .tag("sessionID", input.sessionID)
    .tag("small", (input.small ?? false).toString())
    .tag("agent", input.agent.name)
    .tag("mode", input.agent.mode)
  
  // ...
  
  const system = []
  system.push(
    [
      // use agent prompt otherwise provider prompt
      ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
      // any custom prompt passed into this call
      ...input.system,
      // any custom prompt from last user message
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  )
```

**Agent impacts**:
- System prompt selection
- Temperature and topP settings
- Tool permissions
- Model selection (agent can specify default model)

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/llm.ts` (lines 72, 125, 127)

```typescript
// Line 72: Use agent's prompt if available
...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),

// Line 125: Agent's temperature takes precedence
input.agent.temperature ?? ProviderTransform.temperature(input.model),

// Line 127: Agent's topP setting
topP: input.agent.topP ?? ProviderTransform.topP(input.model),
```

---

## 5. Command System

### Commands Can Specify Agent

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/command/index.ts` (lines 24-35)

```typescript
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),    // <-- Commands can specify an agent
  model: z.string().optional(),
  source: z.enum(["command", "mcp", "skill"]).optional(),
  template: z.promise(z.string()).or(z.string()),
  subtask: z.boolean().optional(),
  hints: z.array(z.string()),
})
```

### Command Execution Agent Resolution

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 1744-1852)

```typescript
export async function command(input: CommandInput) {
  log.info("command", input)
  const command = await Command.get(input.command)
  
  // Line 1747: Resolution order for agent
  const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())
  
  // ... command template processing ...
  
  // Lines 1798-1803: Get agent to resolve model
  if (command.agent) {
    const cmdAgent = await Agent.get(command.agent)
    if (cmdAgent?.model) {
      return cmdAgent.model
    }
  }
  
  const agent = await Agent.get(agentName)
  
  // ... create subtask or regular message ...
  
  const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,     // <-- Agent name in subtask part
```

**Command agent resolution order**:
1. `command.agent` (defined in config)
2. `input.agent` (from command request)
3. `Agent.defaultAgent()` (fallback)

### One-Time vs Persistent

Commands create **one-time effects** - the agent is used to invoke the task, but it's NOT a session-level switch:
- The command itself is processed using the specified agent
- The user's next message can specify a different agent
- No agent state persists between messages

---

## 6. Can a Plugin/Hook Switch Agents Between Turns?

### Plugin Hook System

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/plugin/index.ts` (lines 106-121)

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

**Answer: NO, plugins CANNOT switch agents programmatically.**

**Reasons**:
1. Hook system receives and modifies `output` parameter, not `input`
2. No hook has access to modify the `PromptInput.agent` field
3. Plugin hooks are called DURING processing, not BEFORE message receipt
4. Each message's agent is already determined before the loop begins

**Plugin hooks available**:
- `experimental.chat.system.transform` - modifies system prompt
- `tool.execute.before` - before tool execution
- `tool.execute.after` - after tool execution
- `event` - publishes events

None of these hooks can change which agent processes the message.

---

## 7. Post-Message Hooks

### Hooks Fire During Message Processing, Not Between Turns

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 791-823)

```typescript
// Tool execution hooks
await Plugin.trigger(
  "tool.execute.before",
  {
    tool: item.id,
    sessionID: ctx.sessionID,
    callID: ctx.callID,
  },
  {
    args,
  },
)
const result = await item.execute(args, ctx)

// ... format result ...

await Plugin.trigger(
  "tool.execute.after",
  {
    tool: item.id,
    sessionID: ctx.sessionID,
    callID: ctx.callID,
    args,
  },
  output,
)
```

**Hooks are triggered**:
- During tool execution within a message processing loop
- NOT between assistant response and next user message
- Cannot affect which agent processes the next message

### Session Status Updates

After assistant finishes, session status is set to "idle":

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/prompt.ts` (lines 714-724)

```typescript
SessionCompaction.prune({ sessionID })
for await (const item of MessageV2.stream(sessionID)) {
  if (item.info.role === "user") continue
  const queued = state()[sessionID]?.callbacks ?? []
  for (const q of queued) {
    q.resolve(item)
  }
  return item
}
```

No intermediate hooks that can modify agent selection.

---

## 8. Message Persistence and Storage

### Messages Stored with Agent Name

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/session/index.ts` (lines 670-680)

```typescript
export const updateMessage = fn(MessageV2.Info, async (msg) => {
  const time_created = msg.time.created
  const { id, sessionID, ...data } = msg
  Database.use((db) => {
    db.insert(MessageTable)
      .values({
        id,
        session_id: sessionID,
        time_created,
        data,           // <-- Includes agent: agent.name
      })
  })
```

The entire `MessageV2.Info` object (including `agent` field) is stored in the database.

---

## 9. Agent Configuration Definition

### Agent.Info Schema

**File**: `/Users/pgermishuys/source/opencode/packages/opencode/src/agent/agent.ts` (lines 24-49)

```typescript
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: PermissionNext.Ruleset,
  model: z.object({
    modelID: z.string(),
    providerID: z.string(),
  }).optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  options: z.record(z.string(), z.any()),
  steps: z.number().int().positive().optional(),
})
```

Built-in agents include:
- `build` - primary agent, default
- `plan` - plan mode (read-only tools)
- `general` - general-purpose subagent
- `explore` - exploration-focused subagent

Each agent has unique:
- Permission ruleset
- Default model
- System prompt
- Tool restrictions
- Temperature/topP settings

---

## 10. Complete Message Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ USER UI (app/src/components/prompt-input/submit.ts)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  const currentAgent = local.agent.current()                     │
│  const agent = currentAgent.name                                │
│                                                                  │
│  client.session.promptAsync({                                   │
│    sessionID,                                                   │
│    agent,              <-- UI SELECTS AGENT PER MESSAGE         │
│    model,                                                       │
│    parts,                                                       │
│  })                                                            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                    HTTP POST /session/:sessionID/prompt_async
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ SERVER ENDPOINT (server/routes/session.ts:771-801)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  validator("json", SessionPrompt.PromptInput.omit(...))         │
│  const body = c.req.valid("json")  // contains agent field      │
│  SessionPrompt.prompt({ ...body, sessionID })                   │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ PROMPT FUNCTION (session/prompt.ts:158-185)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  const message = await createUserMessage(input)                 │
│    └─> const agent = await Agent.get(input.agent ?? default)   │
│        └─> AGENT RESOLVED ONCE HERE                            │
│        └─> message.info.agent = agent.name                     │
│                                                                  │
│  if (input.noReply === true) return message                     │
│  return loop({ sessionID: input.sessionID })                    │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ LOOP (session/prompt.ts:274-723)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  while (true) {                                                 │
│    const lastUser = /* find last user message */               │
│    const agent = await Agent.get(lastUser.agent)               │
│      └─> AGENT RETRIEVED FROM MESSAGE                          │
│                                                                  │
│    const processor = SessionProcessor.create({                 │
│      assistantMessage: {                                       │
│        agent: agent.name,                                      │
│      }                                                         │
│    })                                                          │
│                                                                  │
│    const result = await processor.process({                    │
│      user: lastUser,                                           │
│      agent,                                                    │
│      ...                                                       │
│    })                                                          │
│  }                                                            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ PROCESSOR (session/processor.ts)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  const result = await LLM.stream({                              │
│    user: lastUser,                                             │
│    agent,                                                      │
│    model,                                                      │
│    messages: [...],                                           │
│    tools,                                                      │
│  })                                                           │
│                                                               │
│  // Agent's system prompt, temperature, permissions used     │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ LLM CALL (session/llm.ts:46-279)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  const system = [                                               │
│    ...(input.agent.prompt ? [...] : [...]),                    │
│    ...input.system,                                            │
│  ]                                                            │
│                                                               │
│  const options = {                                            │
│    temperature: input.agent.temperature ?? ...,               │
│    topP: input.agent.topP ?? ...,                             │
│    ...                                                        │
│  }                                                           │
│                                                              │
│  return streamText({ messages, system, tools, options })    │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │ LLM RESPONSE WITH TOOLS      │
                        │ (using agent-specific setup) │
                        └──────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │ LOOP CONTINUES               │
                        │ (with same agent until      │
                        │  finish reason != tool-calls)│
                        └──────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │ ASSISTANT MESSAGE SAVED      │
                        │ WITH AGENT NAME              │
                        └──────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                    ▼                                     ▼
        ┌──────────────────────┐          ┌──────────────────────┐
        │ NEXT USER MESSAGE    │          │ LOOP ENDS            │
        │ CAN SPECIFY DIFFERENT│          │ (finish reason)      │
        │ AGENT               │          │                      │
        └──────────────────────┘          └──────────────────────┘
```

---

## 11. Key Files and Line Numbers Summary

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Message Schema | `session/message-v2.ts` | 345-369 (User), 391-415 (Assistant) | Defines agent field in messages |
| PromptInput Schema | `session/prompt.ts` | 100-156 | Input schema with optional agent |
| createUserMessage | `session/prompt.ts` | 954-977 | Resolves agent and stores in message |
| prompt() function | `session/prompt.ts` | 158-185 | Entry point, calls createUserMessage and loop |
| loop() function | `session/prompt.ts` | 274-723 | Main message processing loop |
| Agent retrieval in loop | `session/prompt.ts` | 557 | Gets agent from lastUser message |
| LLM.stream() | `session/llm.ts` | 46-79, 72, 125, 127 | Uses agent config for LLM setup |
| Command handling | `session/prompt.ts` | 1744-1852 | Command-based agent selection |
| Command schema | `command/index.ts` | 24-35 | Command.Info with optional agent |
| Agent schema | `agent/agent.ts` | 24-49 | Agent.Info definition |
| Plugin triggers | `plugin/index.ts` | 106-121 | Plugin hook system (no agent switching) |
| UI agent selection | `app/.../prompt-input/submit.ts` | 129-130, 218, 392-399 | UI sends current agent with message |
| Session endpoint | `server/routes/session.ts` | 730-800 | Prompt and command endpoints |
| Message storage | `session/index.ts` | 670-680 | Stores message with agent field |

---

## 12. Critical Architectural Decisions

### Why Per-Message Agent?

1. **Auditability**: Every message records which agent handled it
2. **Tool permissions**: Different agents have different permission rulesets
3. **Model selection**: Agents can specify default models
4. **Conversation history**: Assistant can reference agent behavior changes
5. **Flexibility**: Users can switch agents at any turn

### Why NOT Session-Level Agent?

1. **Multi-turn flexibility**: User can ask the plan agent, then switch to build
2. **Explicit control**: No implicit state to manage
3. **Plugin safety**: Plugins can't accidentally switch agents
4. **Determinism**: Message behavior is predictable from its fields
5. **Testing**: Each message is independently reproducible

### Why Can't Plugins Switch Agents?

1. Hook system modifies output, not input
2. Agent is resolved before loop processing
3. No hook is called before message creation
4. Ensures plugins can't have side effects on session routing

---

## Conclusion

OpenCode implements **explicit per-message agent selection** with the following characteristics:

✅ **Agent Selection**:
- UI maintains current agent selection
- Each message request specifies agent name
- Agent is resolved once at message creation
- Stored permanently with message

✅ **Switching Mechanism**:
- User clicks agent selector in UI
- Next message uses new agent
- No implicit session state
- No automatic agent changes

✅ **Persistence**:
- Agent name stored in MessageV2.Info
- Assistant message knows which agent served it
- Last user message's agent used for compaction decisions

❌ **Session State**:
- No "currentAgent" field in Session
- No session-level agent tracking
- Only per-message agent records exist

❌ **Plugin Switching**:
- Plugins cannot change agents
- Hook system can only modify outputs
- No hook access to message routing

❌ **Between-Turn Switching**:
- No post-message hooks can change agents
- Agent determined before loop processing
- User must explicitly select for next message

This design ensures **predictability, auditability, and safety** while providing **maximum flexibility** for multi-agent workflows.
