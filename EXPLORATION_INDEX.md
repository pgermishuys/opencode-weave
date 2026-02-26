# Weave Agent Orchestration — Exploration Index

This folder contains complete documentation of how the Weave OpenCode plugin orchestrates its 8 specialized agents.

## 📚 Documentation Files

### 1. **AGENT_QUICK_REFERENCE.md** ⚡ START HERE
- **Best for**: Quick lookup, visual learners, developers
- **Contains**: 
  - 8-agent summary table
  - Two invocation mechanisms (Task tool vs. /start-work command)
  - Agent display names & mode mapping
  - Tool permission matrix
  - Common Q&A
  - Config examples
  - Visual flow diagrams
- **Length**: ~380 lines, ~11KB
- **Time to read**: 5-10 minutes

### 2. **AGENT_ORCHESTRATION_EXPLORATION.md** 📖 DETAILED REFERENCE
- **Best for**: Understanding architecture, debugging, designing new features
- **Contains**:
  - Complete file structure with ALL 60+ file paths
  - Detailed agent architecture explanation
  - Agent switching mechanisms with code flow
  - 6-phase configuration pipeline walkthrough
  - Work state lifecycle & resumption
  - Hook execution order and interactions
  - Visibility & UX model
  - Configuration merge strategy
  - Permission matrix with enforcement details
  - Configuration examples
- **Length**: ~584 lines, ~24KB
- **Time to read**: 30-45 minutes

## 🎯 Quick Navigation

### I want to understand...

**Agent Invocation (Task vs. /start-work)**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Agent Invocation Mechanisms"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Agent Switching & Control Flow"

**Agent Modes & Model Selection**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Agent Modes & Model Selection"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Agent System Architecture"

**Configuration (User vs. Project)**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Config Example"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Configuration Merge Strategy"

**How /start-work Works**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Agent Invocation Mechanisms → Mechanism 2"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Slash Commands & /start-work Implementation"

**Work State & Plan Execution**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Work State Lifecycle"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Work State & Plan Lifecycle"

**Hook Execution Order**
- Quick ref: AGENT_QUICK_REFERENCE.md → "Hook Execution Order"
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "Hooks & Request Processing Pipeline"

**File Organization**
- Deep dive: AGENT_ORCHESTRATION_EXPLORATION.md → "File Structure & Locations"

## 📋 File Locations by Category

### Configuration Files
```
~/.config/opencode/opencode.json          (OpenCode main config)
~/.config/opencode/weave-opencode.jsonc   (Weave user config)
.opencode/weave-opencode.jsonc            (Weave project config)
.weave/plans/*.md                         (Work plans)
.weave/state.json                         (Work state)
```

### Agent Definitions (src/agents/)
```
builtin-agents.ts              AGENT_FACTORIES, AGENT_METADATA
types.ts                       AgentMode, AgentFactory, WeaveAgentName
{loom,tapestry,pattern,...}/
  ├─ index.ts                  Factory function with mode property
  └─ default.ts                Prompt template & configuration
```

### Core Infrastructure (src/)
```
plugin/plugin-interface.ts     Message routing, agent switching
hooks/
  ├─ start-work-hook.ts        /start-work command detection
  ├─ create-hooks.ts           Hook pipeline definition
  └─ *-*.ts                    10 hooks total
features/builtin-commands/
  ├─ commands.ts               /start-work definition
  └─ templates/start-work.ts   Command template
features/work-state/
  ├─ storage.ts                .weave/state.json persistence
  ├─ types.ts                  WorkState, PlanProgress
  └─ validation.ts             Plan structure validation
managers/config-handler.ts     6-phase pipeline
config/
  ├─ schema.ts                 Zod validation
  └─ merge.ts                  Config merging logic
shared/agent-display-names.ts  UI key remapping
```

## 🔑 Key Concepts

### Agent Modes
- **primary**: Loom, Tapestry — respects user UI model selection
- **subagent**: Pattern, Thread, Spindle, Weft, Warp — ignores UI, uses own chain
- **all**: Shuttle — adapts based on context

### Invocation Methods
- **Task tool**: Background subagent (results as tool output, active agent unchanged)
- **/start-work command**: Explicit UI agent switch (Loom → Tapestry)

### Configuration Hierarchy
1. Built-in defaults (lowest priority)
2. User-level: ~/.config/opencode/weave-opencode.jsonc
3. Project-level: .opencode/weave-opencode.jsonc (highest priority)

### Work State
- Created by /start-work command
- Stored at .weave/state.json
- Tracks: active_plan, started_at, session_ids, plan_name
- Enables resumption on session restart
- Cleared when plan complete

## 📊 The 8 Agents

| Agent | Role | Mode | Primary Ability |
|-------|------|------|-----------------|
| Loom | Main Orchestrator | primary | Plan, coordinate, delegate |
| Tapestry | Execution Engine | primary | Execute plans sequentially |
| Pattern | Strategic Planner | subagent | Create detailed plans (.weave/*.md) |
| Thread | Code Explorer | subagent | Fast codebase search (read-only) |
| Spindle | External Researcher | subagent | Documentation lookup (read-only) |
| Weft | Reviewer | subagent | Plan & code review (read-only) |
| Warp | Security Auditor | subagent | Security compliance (read-only) |
| Shuttle | Category Specialist | all | Domain-specific dispatch |

## 🏗️ Architecture Layers

### Layer 1: Agent Definition
- Each agent has a factory function with a `mode` property
- Factory called with resolved model name → returns AgentConfig
- Config includes prompt, temperature, tool permissions, description

### Layer 2: Configuration Pipeline
- 6 phases of transformation
- Merges user + project configs
- Filters disabled agents
- Remaps keys to display names for OpenCode UI

### Layer 3: Plugin Interface
- Intercepts all chat messages
- Fires hooks in sequence
- Detects /start-work command
- Mutates message.agent to trigger routing
- Injects context (plan path, progress, etc.)

### Layer 4: Hooks
- Request processing pipeline
- Detects commands, keywords, completion
- Enforces restrictions (Pattern MD-only, etc.)
- Manages work state and session tracking

### Layer 5: Work State
- Persistent JSON file at .weave/state.json
- Tracks active plan and progress
- Enables resumption and multi-session work

## 🎓 Learning Paths

### Path 1: "I'm implementing a new feature"
1. Read AGENT_QUICK_REFERENCE.md (5 min overview)
2. Check AGENT_ORCHESTRATION_EXPLORATION.md for relevant section
3. Locate specific file in "File Structure & Locations"
4. Follow line number references in docs to actual code

### Path 2: "I'm debugging agent behavior"
1. Check AGENT_QUICK_REFERENCE.md → "Hook Execution Order"
2. Review AGENT_ORCHESTRATION_EXPLORATION.md → "Hooks & Request Processing Pipeline"
3. Trace execution in plugin-interface.ts + relevant hook file
4. Check config schema in schema.ts for permission rules

### Path 3: "I'm adding a new agent"
1. Review AGENT_ORCHESTRATION_EXPLORATION.md → "Agent System Architecture"
2. Study existing agent in src/agents/{agent}/ directory
3. Create index.ts with AgentFactory and mode property
4. Create default.ts with prompt template
5. Add to AGENT_FACTORIES in builtin-agents.ts
6. Update docs/agent-interactions.md with new agent info

### Path 4: "I'm understanding work flow"
1. AGENT_QUICK_REFERENCE.md → "Visual: Plan Execution Flow"
2. AGENT_ORCHESTRATION_EXPLORATION.md → "Work State & Plan Lifecycle"
3. AGENT_ORCHESTRATION_EXPLORATION.md → "Hook Execution Order in chat.message Event"

## 🔗 Official Documentation

Also available in the repo:
- `docs/configuration.md` — Full configuration schema reference
- `docs/agent-interactions.md` — Workflow diagrams and state machines
- `README.md` — High-level overview and installation

## 📝 Notes

- All file paths are absolute paths starting with `/Users/pgermishuys/source/weave/src`
- Line numbers reference the specific file content at time of exploration (Feb 26, 2025)
- Code samples show actual TypeScript from the codebase
- Diagrams use Mermaid syntax compatible with GitHub/GitLab rendering

---

Last updated: February 26, 2025
Exploration depth: Complete with 60+ source files analyzed
