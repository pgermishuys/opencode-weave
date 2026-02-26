# OpenCode Agent Switching - Quick Reference

## TL;DR

**OpenCode uses per-message agent selection, NOT session-level agent state.**

- Each message specifies `agent: string` field
- Agent resolved at message creation time
- Stored permanently with message
- Cannot be changed by plugins or hooks between turns
- User must explicitly select agent for next message

---

## Code Locations

### 1. Message Agent Field Definition
- **User messages**: `packages/opencode/src/session/message-v2.ts:358`
- **Assistant messages**: `packages/opencode/src/session/message-v2.ts:415`

### 2. Agent Selection Entry Points
- **UI sends agent**: `packages/app/src/components/prompt-input/submit.ts:218, 394`
- **API receives agent**: `packages/opencode/src/server/routes/session.ts:759, 791`
- **Agent resolved**: `packages/opencode/src/session/prompt.ts:955`

### 3. Message Creation (Immutable Agent)
- **createUserMessage()**: `packages/opencode/src/session/prompt.ts:954-977`
  - Line 955: `const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))`
  - Line 972: `agent: agent.name` (stored in message)

### 4. Loop Processing (Using Stored Agent)
- **SessionPrompt.loop()**: `packages/opencode/src/session/prompt.ts:274-723`
  - Line 557: `const agent = await Agent.get(lastUser.agent)`
  - Line 572: Creates assistant with `agent: agent.name`

### 5. LLM Configuration (Agent-Specific Settings)
- **LLM.stream()**: `packages/opencode/src/session/llm.ts:46-127`
  - Line 72: Uses `input.agent.prompt` for system prompt
  - Line 125: Uses `input.agent.temperature`
  - Line 127: Uses `input.agent.topP`

### 6. Command Agent Selection
- **Command execution**: `packages/opencode/src/session/prompt.ts:1747`
  - Resolution: `command.agent ?? input.agent ?? Agent.defaultAgent()`

### 7. Plugin Hook System
- **No agent switching hooks**: `packages/opencode/src/plugin/index.ts:106-121`
- Available hooks modify output only, cannot change routing

---

## Data Flow

```
UI: local.agent.current().name
        ↓
HTTP Request: { agent: "build", ... }
        ↓
Server: SessionPrompt.prompt({ agent, ... })
        ↓
Resolve: Agent.get(agent)
        ↓
Store: Message { agent: agent.name, ... }
        ↓
Loop: Agent.get(lastUser.agent)  ← Retrieved from stored message
        ↓
LLM: streamText({ agent, ... })  ← Agent's settings applied
        ↓
Return: Assistant { agent: agent.name, ... }
```

---

## Agent Resolution Hierarchy

```
Per-Message Flow:
1. UI selects agent → local.agent.current().name
2. Request sent → PromptInput.agent
3. Message created → Agent.get(input.agent ?? default)
4. Stored → MessageV2.Info.agent
5. Loop uses → Agent.get(lastUser.agent)

Command Flow:
1. Command defined → Command.Info.agent (optional)
2. Command invoked → CommandInput.agent (optional)
3. Resolved → command.agent ?? input.agent ?? default
```

---

## What Happens Between Turns?

```
User Message 1 (agent: "build")
        ↓
Assistant Response 1 (agent: "build")
        ↓
    [NO AGENT CHANGE POSSIBLE HERE]
    [Plugins cannot modify routing]
    [No intermediate hooks]
        ↓
User Message 2 (agent: ??? - user must select)
        ↓
If agent != "build":
  → Different agent processes
  → Different permissions
  → Different system prompt
  → Different model (possibly)
```

---

## Session State

**What Session does NOT track:**
- ❌ Current agent
- ❌ Active agent per session
- ❌ Agent switching state
- ❌ Session-level agent config

**What Session DOES store:**
- ✅ Messages with agent field
- ✅ User message agent = Used by loop to process
- ✅ Assistant message agent = Which agent served it
- ✅ Compaction agent = Last user message's agent

**Proof**: Session.Info schema in `packages/opencode/src/session/index.ts` has NO agent field.

---

## Plugin/Hook Limitations

**Cannot be done:**
- Plugin switching agent between turns
- Plugin modifying message routing
- Hook changing which agent processes a message
- Programmatic agent changes after message received

**Why:**
- Hook input/output signature cannot access routing
- Agent resolved before loop begins
- Plugin hooks called during processing, not before
- No hook can modify PromptInput.agent

---

## Agent Configuration

Each agent has:
- `name`: identifier (e.g., "build", "plan")
- `permission`: ruleset for tool access
- `mode`: "primary", "subagent", or "all"
- `prompt`: system prompt override
- `temperature`, `topP`: LLM parameters
- `model`: default model (providerID/modelID)
- `steps`: max conversation steps
- `hidden`: visibility in UI

**Built-in agents:**
- `build` - primary agent, default, edit tools
- `plan` - read-only planning mode
- `general` - subagent for parallel work
- `explore` - exploration-only subagent

---

## Key Insights

1. **Agent is immutable per message**: Set at creation, never changes
2. **Agent is a message field**: Stored and retrieved like model, sessionID, etc.
3. **Agent selection is UI-driven**: No programmatic switching in framework
4. **Agent determines behavior**: Permissions, prompt, model, settings all from agent config
5. **No session state**: Agent info comes from per-message field, not session state
6. **Plugin-safe**: Hooks can't accidentally switch agents
7. **Auditable**: Every message records which agent handled it
8. **Per-turn flexibility**: Each message can use different agent

---

## Testing / Verification

To verify agent behavior:
1. Check `Message.info.agent` field
2. Look at `Agent.get(agentName)` for config
3. Trace through `SessionPrompt.loop()` with specific message
4. Inspect LLM call parameters for agent-specific settings
5. Search for "currentAgent" - should NOT find session state

---

## Files by Concern

### Message Structure
- `packages/opencode/src/session/message-v2.ts`

### Message Creation
- `packages/opencode/src/session/prompt.ts` (lines 954-977)

### Message Processing
- `packages/opencode/src/session/prompt.ts` (lines 274-723)

### Agent Definitions
- `packages/opencode/src/agent/agent.ts`

### LLM Usage
- `packages/opencode/src/session/llm.ts`

### Server Endpoints
- `packages/opencode/src/server/routes/session.ts`

### UI Submission
- `packages/app/src/components/prompt-input/submit.ts`

### Plugin System
- `packages/opencode/src/plugin/index.ts`

### Session Storage
- `packages/opencode/src/session/index.ts`
