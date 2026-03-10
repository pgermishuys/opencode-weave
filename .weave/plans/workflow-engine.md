# Workflow Engine

## TL;DR
> **Summary**: Build a declarative workflow engine with a template+instance model: reusable workflow definitions (templates) are instantiated per user goal, with context threading that passes the original goal and accumulated artifacts through every step, driven by the existing hook system and agent switching.
> **Estimated Effort**: XL

## Context

### Original Request
Build a workflow engine for the Weave OpenCode plugin that supports declarative, multi-step workflows with three step types (interactive, autonomous, gate), a workflow state machine with persistence and resume, artifact passing between steps, and integration with the existing hook system, slash commands, and agent switching.

### Key Redesign: Template + Instance Model
The original plan conflated workflow definitions with workflow executions. This redesign separates them:

- **Workflow Definition** (template) = reusable process stored in `.opencode/workflows/`. Doesn't change per invocation. Example: "gather → plan → review → build → review".
- **Workflow Instance** = a specific execution of that template, bound to a user goal ("Add OAuth2 login with Google and GitHub providers"), with accumulated artifacts, step states, and a unique instance ID.
- **Context Threading** = every step receives the original goal AND accumulated context from prior steps, so each agent understands what the user wants and what's been done so far.

### Key Findings

**Existing Architecture (what we build on):**

1. **WorkState** (`src/features/work-state/`): Tracks a single active plan via `.weave/state.json`. Has `active_plan`, `session_ids`, `agent`, `paused`, `plan_name`, `start_sha`, and stale-continuation tracking. Read/write/clear are simple JSON file operations. **Decision**: WorkflowInstance will be a parallel system — WorkState tracks plan checkbox progress; WorkflowInstance tracks multi-step workflow orchestration. They can coexist (a workflow step might use /start-work internally).

2. **Hooks** (`src/hooks/create-hooks.ts` + `src/plugin/plugin-interface.ts`): Plugin hooks are registered via `createHooks()` and consumed in `createPluginInterface()`. Key hook points we'll use:
   - `chat.message` — detect `/run-workflow` commands and inject workflow context
   - `session.idle` — drive autonomous step transitions (like work-continuation does)
   - `command.execute.before` — inject data for the `/run-workflow` command template
   - `event` — listen for `session.idle`, `tui.command.execute` (interrupts)

3. **Builtin Commands** (`src/features/builtin-commands/`): Commands are defined as `BuiltinCommand` objects with `name`, `description`, `agent`, `template`, and optional `argumentHint`. Templates use `$SESSION_ID`, `$TIMESTAMP`, `$ARGUMENTS` placeholders. Registered via `ConfigHandler.applyCommandConfig()` which maps agent names to display names.

4. **Agent Switching**: Commands specify a target `agent` field. In `chat.message`, the plugin mutates `output.message.agent` to the display name via `getAgentDisplayName()`. This is how `/start-work` switches to Tapestry. **The same mechanism works for workflow step transitions.**

5. **Config Schema** (`src/config/schema.ts`): Uses Zod schemas. Config is loaded from user-level (`~/.config/opencode/weave-opencode.jsonc`) and project-level (`.opencode/weave-opencode.jsonc`), merged with project taking precedence. **Workflows will follow a similar discovery pattern** but from dedicated `workflows/` directories.

6. **Skill Loader** (`src/features/skill-loader/`): Discovers markdown files with YAML frontmatter from multiple locations (user, project, API). **Workflow definitions will use a similar multi-location discovery pattern** but with JSONC files.

7. **Background Manager** (`src/managers/background-manager.ts`): In-memory task lifecycle tracking (pending → running → completed/failed/cancelled). Good pattern for workflow step status tracking.

8. **OpenCode Plugin API** (`@opencode-ai/plugin`): The `session.promptAsync()` method lets us inject prompts into sessions programmatically — this is how continuation works and how we'll drive autonomous workflow steps. The `promptAsync` body type (`SessionPromptAsyncData.body`) supports: `parts`, `agent?: string`, `model?`, `system?`, `tools?`, `noReply?`, `messageID?`. **The `agent` field is confirmed in the SDK types** — we can pass the agent name directly in the `promptAsync` body to switch agents on continuation prompts. The `command.execute.before` hook gives us access to inject parts into command output.

9. **Plan Validation** (`src/features/work-state/validation.ts`): Validates plan structure before execution. We'll need similar validation for workflow definitions.

**Key Constraints:**
- OpenCode's agent switching works two ways: (1) mutating `output.message.agent` in `chat.message` for user-initiated messages, and (2) passing the `agent` field in the `promptAsync` body for programmatic continuations. Both are verified in the SDK types.
- There's no way to "spawn a new session with a specific agent" from the plugin — we work within the current session.
- The `session.idle` event is our main driver for autonomous progression — when the agent finishes responding and goes idle, we can inject the next step's prompt.
- Step completion detection must work within existing hook points (chat.message, session.idle, tool.execute.after).
- **Message content is NOT available from `message.updated` events** — the SDK `AssistantMessage` type has no `content`/`text` field. Message text must be obtained either via `message.part.updated` events (which carry `TextPart.text`) or by calling `client.session.messages()` API. The `message.part.updated` approach is preferred (real-time, no extra API call).
- **Auto-pause guard**: The `chat.message` handler auto-pauses WorkState when a message arrives without `<session-context>` or `CONTINUATION_MARKER`. Workflow continuation prompts injected via `promptAsync` flow through `chat.message`, so they need their own marker (`WORKFLOW_CONTINUATION_MARKER`) to avoid triggering auto-pause on coexisting plans.

## Objectives

### Core Objective
Create a workflow engine feature module that enables declarative multi-step workflows with a template+instance model, context threading, and state machine semantics, integrated with Weave's existing hook system and agent architecture.

### Deliverables
- [ ] Workflow definition schema (Zod) and JSONC format
- [ ] Workflow instance model with goal, context, and accumulated artifacts
- [ ] Workflow discovery from multiple locations
- [ ] Workflow state machine with persistence (instance-based storage)
- [ ] Context threading engine (composes prompts with goal + prior step results)
- [ ] Step execution engine with three step types (interactive, autonomous, gate)
- [ ] Step completion detection
- [ ] Agent switching per step
- [ ] Artifact passing between steps
- [ ] `/run-workflow` slash command with instance-aware invocation semantics
- [ ] Workflow state hook (drives step transitions on session.idle)
- [ ] Integration into plugin lifecycle (createHooks, createPluginInterface)
- [ ] Resume/recovery after interruption
- [ ] Unit + integration tests

### Definition of Done
- [ ] `bun test` passes with all new and existing tests
- [ ] `bun run build` succeeds with no type errors
- [ ] A sample workflow JSONC file can be loaded, validated, and instantiated with a goal
- [ ] Workflow instance state persists to `.weave/workflows/{instance-id}/state.json` and survives session restart
- [ ] Context threading works: each step prompt includes the original goal and prior step outputs
- [ ] Agent switching works correctly per step
- [ ] Interactive steps pause for user input; autonomous steps proceed automatically
- [ ] `/run-workflow secure-feature "Add OAuth2 login"` creates an instance bound to that goal
- [ ] `/run-workflow` with no args resumes an active instance or lists available definitions

### Guardrails (Must NOT)
- Must NOT break existing `/start-work` functionality — WorkState remains independent
- Must NOT add new npm dependencies (use existing: zod, jsonc-parser, fs/path/os)
- Must NOT require changes to OpenCode core or the plugin SDK
- Must NOT implement UI rendering (Phase 1 is CLI/chat only)
- Must NOT implement parallel steps (deferred to Phase 2)
- Must NOT implement conditional steps (deferred to Phase 2)

## Design

### Core Concept: Template + Instance

```
┌─────────────────────────────┐
│   Workflow Definition       │  Reusable template
│   (secure-feature.jsonc)    │  Stored in .opencode/workflows/
│                             │  Defines steps, agents, prompts
│   steps: gather → plan →    │  Does NOT change per invocation
│          review → build →   │
│          review             │
└──────────────┬──────────────┘
               │ instantiate with goal
               ▼
┌─────────────────────────────┐
│   Workflow Instance          │  Specific execution
│   ID: wf_a1b2c3             │  Bound to user goal
│                              │
│   goal: "Add OAuth2 login    │
│          with Google and     │
│          GitHub providers"   │
│                              │
│   artifacts:                 │
│     spec: "Users need..."    │
│     plan_path: ".weave/..."  │
│                              │
│   steps:                     │
│     gather: ✓ completed      │
│     plan: ✓ completed        │
│     review: → active         │
│     build: pending           │
│     review: pending          │
└─────────────────────────────┘
```

### Workflow Definition Format (JSONC)

```jsonc
// .opencode/workflows/secure-feature.jsonc
{
  "name": "secure-feature",
  "description": "Plan, build, review, and security-audit a new feature",
  "version": 1,
  "steps": [
    {
      "id": "gather",
      "name": "Gather Requirements",
      "type": "interactive",
      "agent": "loom",
      "prompt": "You are gathering requirements for a new feature.\nThe user's goal is: {{instance.goal}}\n\nAsk the user what they want to build, clarify edge cases,\nand produce a brief specification document.\nWhen the user confirms the spec, signal completion.",
      "completion": {
        "method": "user_confirm"
      },
      "artifacts": {
        "outputs": [
          { "name": "spec", "description": "Feature specification" }
        ]
      }
    },
    {
      "id": "plan",
      "name": "Create Plan",
      "type": "autonomous",
      "agent": "pattern",
      "prompt": "Based on the requirements gathered, create a detailed implementation plan.\nSave it to .weave/plans/{{instance.slug}}.md",
      "completion": {
        "method": "plan_created",
        "plan_name": "{{instance.slug}}"
      },
      "artifacts": {
        "inputs": [{ "name": "spec" }],
        "outputs": [{ "name": "plan_path", "description": "Path to the created plan file" }]
      }
    },
    {
      "id": "plan-review",
      "name": "Plan Review",
      "type": "gate",
      "agent": "weft",
      "prompt": "Review the plan at {{artifacts.plan_path}}.\nEvaluate structure, completeness, and feasibility.",
      "completion": {
        "method": "review_verdict"
      },
      "on_reject": "pause"
    },
    {
      "id": "execute",
      "name": "Execute Plan",
      "type": "autonomous",
      "agent": "tapestry",
      "prompt": "Execute the plan at {{artifacts.plan_path}}.\nWork through each task systematically.",
      "completion": {
        "method": "plan_complete",
        "plan_name": "{{instance.slug}}"
      }
    },
    {
      "id": "code-review",
      "name": "Code Review",
      "type": "gate",
      "agent": "weft",
      "prompt": "Review all changes made during plan execution.\nRun `git diff` to see the changes.",
      "completion": {
        "method": "review_verdict"
      },
      "on_reject": "pause"
    },
    {
      "id": "security-review",
      "name": "Security Audit",
      "type": "gate",
      "agent": "warp",
      "prompt": "Security audit all changes made during plan execution.\nFocus on auth, crypto, input validation, and injection risks.",
      "completion": {
        "method": "review_verdict"
      },
      "on_reject": "pause"
    }
  ]
}
```

### Workflow Instance State

```typescript
interface WorkflowInstance {
  /** Unique instance ID (e.g., "wf_a1b2c3d4") */
  instance_id: string
  /** ID of the workflow definition (matches definition name) */
  definition_id: string
  /** Human-readable workflow name */
  definition_name: string
  /** Path to the workflow definition file */
  definition_path: string
  /** The user's goal — what they're trying to accomplish */
  goal: string
  /** URL-safe slug derived from the goal (for plan filenames, etc.) */
  slug: string
  /** Current workflow-level status */
  status: "running" | "paused" | "completed" | "failed" | "cancelled"
  /** ISO timestamp when the instance was created */
  started_at: string
  /** ISO timestamp when the instance completed/failed/cancelled */
  ended_at?: string
  /** Session IDs that have participated in this instance */
  session_ids: string[]
  /** ID of the currently active step */
  current_step_id: string
  /** Per-step state */
  steps: Record<string, StepState>
  /** Accumulated artifacts from completed steps (name → value) */
  artifacts: Record<string, string>
  /** Why the workflow is paused (if paused) */
  pause_reason?: string
}

interface StepState {
  id: string
  status: "pending" | "active" | "awaiting_user" | "completed" | "failed" | "skipped"
  started_at?: string
  completed_at?: string
  /** For gate steps: the verdict */
  verdict?: "approve" | "reject"
  /** Error message if failed */
  error?: string
  /** Artifacts produced by this step */
  artifacts?: Record<string, string>
  /** Summary of what this step produced (for context threading) */
  summary?: string
}
```

### Context Threading

When the engine activates a step, it composes a **context-threaded prompt** that gives the agent full awareness of the workflow:

```markdown
## Workflow Context
**Goal**: "Add OAuth2 login with Google and GitHub providers"
**Workflow**: secure-feature (step 3 of 6: Plan Review)

### Completed Steps
- [✓] **Gather Requirements** → "Users need Google and GitHub OAuth2 login. Must support PKCE flow. Store refresh tokens securely."
- [✓] **Create Plan** → plan saved to .weave/plans/add-oauth2-login.md

### Accumulated Artifacts
- **spec**: "Users need Google and GitHub OAuth2 login..."
- **plan_path**: ".weave/plans/add-oauth2-login.md"

---

## Your Task
Review the plan at .weave/plans/add-oauth2-login.md.
Evaluate structure, completeness, and feasibility.
```

This is assembled by the **context composer** from: (1) the instance's goal, (2) step history from instance state, (3) the step's prompt template with variables resolved.

### Instance Storage

```
.weave/workflows/
├── wf_a1b2c3d4/
│   └── state.json          # WorkflowInstance JSON
├── wf_e5f6g7h8/
│   └── state.json          # Another instance (completed/archived)
└── active-instance.json    # Pointer: { "instance_id": "wf_a1b2c3d4" }
```

**Design decisions:**
- Each instance gets its own directory under `.weave/workflows/{instance-id}/`.
- `active-instance.json` tracks which instance is currently active (fast lookup without scanning all directories).
- Phase 1 supports only ONE active instance at a time. Starting a new workflow while one is active requires the user to pause/abort the current one first.
- Completed instances remain on disk (for history) until manually cleaned up. The `status: "completed"` field distinguishes them.
- The data model supports multi-instance from day one — no migration needed later.

### Workflow State Machine

```
Instance-level states:
  create → running → paused → running → completed
                            → failed
                            → cancelled

Step-level states:
  pending → active → awaiting_user → completed
                   → failed
                   → skipped

Transitions:
  workflow.start(goal) → creates instance, first step becomes active
  step.complete → next step becomes active (or workflow.complete if last)
  step.fail → workflow pauses (user decides: retry, skip, abort)
  gate.reject → workflow pauses (on_reject: "pause") or fails (on_reject: "fail")
  gate.approve → next step
  user.interrupt → workflow pauses
  user.resume → current step re-activates
  user.skip → current step skipped, next activates
  user.abort → workflow cancelled
```

### Step Completion Detection

Each step type has a different completion mechanism:

| Completion Method | How It Works | Hook Point |
|---|---|---|
| `user_confirm` | Scan agent response for confirmation keywords ("approved", "confirmed", "let's proceed") OR user says "continue"/"done" | `chat.message` (for user input), `session.idle` (for agent response) |
| `plan_created` | Check if `.weave/plans/{name}.md` exists and has valid structure | `session.idle` |
| `plan_complete` | Check `getPlanProgress()` returns `isComplete: true` | `session.idle` |
| `review_verdict` | Scan agent's response for `[APPROVE]` or `[REJECT]` markers (Weft/Warp already use these) | `session.idle` (after agent finishes review) |
| `agent_signal` | Agent explicitly outputs a completion marker: `<!-- workflow:step-complete -->` | `session.idle` |

### Invocation Semantics

```
/run-workflow secure-feature "Add OAuth2 login"
  → Creates a new instance of secure-feature with goal "Add OAuth2 login"
  → Activates the first step (gather) with the goal injected

/run-workflow secure-feature (no goal)
  → If an active instance exists for secure-feature → resume it
  → Otherwise → start the gather step interactively to collect the goal

/run-workflow (no args)
  → If any active instance exists → resume it
  → Otherwise → list available workflow definitions

/run-workflow --status
  → Show the current instance state (which step, progress, goal)
```

### Key Implementation Decision: How Transitions Work

The workflow engine operates as a state machine driven by `session.idle` events:

1. When a workflow is active and `session.idle` fires:
   a. Read the active instance from disk
   b. Check if the current step's completion condition is met
   c. If met: mark step complete (capture artifacts + summary), advance to next step, compose context-threaded prompt for next step, inject it
   d. If not met and step is autonomous: re-inject continuation prompt
   e. If not met and step is interactive: do nothing (wait for user)

2. When `chat.message` fires with a user message during an active workflow:
   a. For interactive steps: check if the user message signals completion
   b. Route the message to the correct agent for the current step
   c. Handle workflow control commands (`workflow pause`, `workflow skip`, `workflow abort`)

3. Agent switching happens naturally via the `output.message.agent` mutation pattern already used by `/start-work`.

### Instance ID Generation

Instance IDs are short, human-friendly identifiers:
- Format: `wf_{8 random hex chars}` (e.g., `wf_a1b2c3d4`)
- Generated via `crypto.randomBytes(4).toString('hex')` (Node.js built-in, no deps)
- Collision-safe for practical use (4 billion possible values)

### Goal Slug Generation

The `slug` field is derived from the goal for use in filenames:
- Lowercase, spaces → hyphens, strip non-alphanumeric, truncate to 50 chars
- Example: `"Add OAuth2 login with Google and GitHub providers"` → `"add-oauth2-login-with-google-and-github-providers"`
- Used in template variables like `{{instance.slug}}` for plan file names

## TODOs

### Phase 1: Core Engine (In Scope)

- [x] 1. Create workflow types and schema
  **What**: Define TypeScript types for workflow definitions, step definitions, completion methods, workflow instances, and step states. Create Zod validation schema for JSONC workflow definition files. The critical new types are `WorkflowInstance` (with `goal`, `slug`, `instance_id`) and the template variable namespaces (`instance.*`, `artifacts.*`, `step.*`).
  **Files**: `src/features/workflow/types.ts`, `src/features/workflow/schema.ts`
  **Acceptance**: Types compile, Zod schema validates the example JSONC structure above. Unit tests for schema validation (valid input passes, invalid input fails with clear messages).

  ```typescript
  // types.ts — key types (not exhaustive, see Design section for full interfaces)
  export type StepType = "interactive" | "autonomous" | "gate"
  export type CompletionMethod = "user_confirm" | "plan_created" | "plan_complete" | "review_verdict" | "agent_signal"
  export type StepStatus = "pending" | "active" | "awaiting_user" | "completed" | "failed" | "skipped"
  export type WorkflowStatus = "running" | "paused" | "completed" | "failed" | "cancelled"
  export type OnRejectAction = "pause" | "fail"

  export interface ArtifactRef {
    name: string
    description?: string
  }

  export interface StepArtifacts {
    inputs?: ArtifactRef[]
    outputs?: ArtifactRef[]
  }

  export interface CompletionConfig {
    method: CompletionMethod
    plan_name?: string
    keywords?: string[]
  }

  export interface WorkflowStepDefinition {
    id: string
    name: string
    type: StepType
    agent: string
    prompt: string
    completion: CompletionConfig
    artifacts?: StepArtifacts
    on_reject?: OnRejectAction
  }

  export interface WorkflowDefinition {
    name: string
    description?: string
    version: number
    steps: WorkflowStepDefinition[]
  }

  export interface StepState {
    id: string
    status: StepStatus
    started_at?: string
    completed_at?: string
    verdict?: "approve" | "reject"
    error?: string
    artifacts?: Record<string, string>
    /** Summary of what this step produced (for context threading) */
    summary?: string
  }

  export interface WorkflowInstance {
    instance_id: string
    definition_id: string
    definition_name: string
    definition_path: string
    goal: string
    slug: string
    status: WorkflowStatus
    started_at: string
    ended_at?: string
    session_ids: string[]
    current_step_id: string
    steps: Record<string, StepState>
    artifacts: Record<string, string>
    pause_reason?: string
  }

  /** Pointer file content — tracks which instance is active */
  export interface ActiveInstancePointer {
    instance_id: string
  }
  ```

  ```typescript
  // schema.ts — Zod validation for JSONC workflow definitions
  import { z } from "zod"

  export const CompletionConfigSchema = z.object({
    method: z.enum(["user_confirm", "plan_created", "plan_complete", "review_verdict", "agent_signal"]),
    plan_name: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  })

  export const ArtifactRefSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
  })

  export const StepArtifactsSchema = z.object({
    inputs: z.array(ArtifactRefSchema).optional(),
    outputs: z.array(ArtifactRefSchema).optional(),
  })

  export const WorkflowStepSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string(),
    type: z.enum(["interactive", "autonomous", "gate"]),
    agent: z.string(),
    prompt: z.string(),
    completion: CompletionConfigSchema,
    artifacts: StepArtifactsSchema.optional(),
    on_reject: z.enum(["pause", "fail"]).optional(),
  })

  export const WorkflowDefinitionSchema = z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    description: z.string().optional(),
    version: z.number().int().positive(),
    steps: z.array(WorkflowStepSchema).min(1),
  })
  ```

- [x] 2. Create workflow instance storage
  **What**: Implement read/write/clear for workflow instances at `.weave/workflows/{instance-id}/state.json` and an active-instance pointer at `.weave/workflows/active-instance.json`. Follow the same patterns as `src/features/work-state/storage.ts`. Include helper functions for instance lifecycle, instance ID generation, and goal slug generation.
  **Files**: `src/features/workflow/storage.ts`, `src/features/workflow/constants.ts`
  **Acceptance**: Can create/read/write/clear workflow instances. Active instance pointer works. Round-trip test: write instance → read instance → values match. Missing file returns null. Malformed JSON returns null. Slug generation handles edge cases (special chars, long strings, empty strings).

  ```typescript
  // constants.ts
  export const WORKFLOWS_STATE_DIR = ".weave/workflows"
  export const INSTANCE_STATE_FILE = "state.json"
  export const ACTIVE_INSTANCE_FILE = "active-instance.json"
  export const WORKFLOWS_DIR_PROJECT = ".opencode/workflows"
  export const WORKFLOWS_DIR_USER = "workflows" // under ~/.config/opencode/
  ```

  ```typescript
  // storage.ts — key functions
  import { randomBytes } from "node:crypto"

  /** Generate a unique instance ID */
  export function generateInstanceId(): string {
    return `wf_${randomBytes(4).toString("hex")}`
  }

  /** Generate a URL-safe slug from a goal string */
  export function generateSlug(goal: string): string {
    return goal
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50)
  }

  /** Create a fresh WorkflowInstance for a definition + goal */
  export function createWorkflowInstance(
    definition: WorkflowDefinition,
    definitionPath: string,
    goal: string,
    sessionId: string,
  ): WorkflowInstance

  /** Read a workflow instance by ID. Returns null if not found. */
  export function readWorkflowInstance(directory: string, instanceId: string): WorkflowInstance | null

  /** Write a workflow instance to its state directory. */
  export function writeWorkflowInstance(directory: string, instance: WorkflowInstance): boolean

  /** Read the active instance pointer. Returns null if no active instance. */
  export function readActiveInstance(directory: string): ActiveInstancePointer | null

  /** Set the active instance pointer. */
  export function setActiveInstance(directory: string, instanceId: string): boolean

  /** Clear the active instance pointer (without deleting the instance). */
  export function clearActiveInstance(directory: string): boolean

  /** Get the active workflow instance (resolves pointer → reads instance). */
  export function getActiveWorkflowInstance(directory: string): WorkflowInstance | null

  /** List all instance IDs (for status/history commands). */
  export function listInstances(directory: string): string[]

  /** Append a session ID to an instance's session_ids. */
  export function appendInstanceSessionId(
    directory: string,
    instanceId: string,
    sessionId: string,
  ): WorkflowInstance | null
  ```

- [x] 3. Create workflow discovery and loading
  **What**: Discover workflow JSONC files from project (`.opencode/workflows/`) and user (`~/.config/opencode/workflows/`) directories. Parse with `jsonc-parser`, validate with Zod schema. Return list of available workflow definitions. Follow the same multi-location discovery pattern as `src/features/skill-loader/discovery.ts`.
  **Files**: `src/features/workflow/discovery.ts`
  **Acceptance**: Discovers workflow files from both locations. Project workflows override user workflows with the same name. Returns validated `WorkflowDefinition[]` with their file paths. Invalid files are logged and skipped.

  ```typescript
  export interface DiscoveredWorkflow {
    definition: WorkflowDefinition
    path: string
    scope: "project" | "user"
  }

  /** Discover all valid workflow definitions from project + user directories. */
  export function discoverWorkflows(directory: string): DiscoveredWorkflow[]

  /** Load and validate a single workflow definition from a file path. */
  export function loadWorkflowDefinition(filePath: string): WorkflowDefinition | null
  ```

- [x] 4. Create context composer and template resolver
  **What**: The context composer is the key new component. It takes a `WorkflowInstance` and the current step's `WorkflowStepDefinition` and produces a complete, context-threaded prompt. This involves: (1) resolving template variables (`{{instance.goal}}`, `{{instance.slug}}`, `{{artifacts.plan_path}}`, `{{step.name}}`), (2) building the workflow context header (goal, step history with summaries, accumulated artifacts), (3) combining them into the final prompt.
  **Files**: `src/features/workflow/context.ts`
  **Acceptance**: Composes prompts with full workflow context. Template variables resolve correctly. Unknown variables are left as-is. Missing artifacts show "(not yet available)". Step history shows completed/active/pending status with summaries. Unit tests for: empty context (first step), mid-workflow context (some steps done), all variables resolved, missing artifacts.

  ```typescript
  /** Resolve template variables in a string using instance + artifact data */
  export function resolveTemplate(
    template: string,
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
  ): string

  /** Build the full context-threaded prompt for a step */
  export function composeStepPrompt(
    stepDef: WorkflowStepDefinition,
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
  ): string

  /** Build the workflow context header (goal, history, artifacts) */
  export function buildContextHeader(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
  ): string
  ```

  Example output of `composeStepPrompt()`:
  ```markdown
  ## Workflow Context
  **Goal**: "Add OAuth2 login with Google and GitHub providers"
  **Workflow**: secure-feature (step 3 of 6: Plan Review)

  ### Completed Steps
  - [✓] **Gather Requirements** → "Users need Google and GitHub OAuth2 login. Must support PKCE flow. Store refresh tokens securely."
  - [✓] **Create Plan** → plan saved to .weave/plans/add-oauth2-login.md

  ### Accumulated Artifacts
  - **spec**: "Users need Google and GitHub OAuth2 login..."
  - **plan_path**: ".weave/plans/add-oauth2-login.md"

  ---

  ## Your Task
  Review the plan at .weave/plans/add-oauth2-login.md.
  Evaluate structure, completeness, and feasibility.
  ```

- [x] 5. Create step completion detectors
  **What**: Implement completion detection for each `CompletionMethod`. Each detector receives the current state and returns whether the step is complete, any artifacts produced, and an optional summary. The summary is critical for context threading — it captures what the step produced in a concise form that later steps can reference.

  **Important SDK constraint**: The `message.updated` event does NOT carry message text content. The `AssistantMessage` type only has metadata (tokens, cost, model, etc.), NOT the message body. To access the actual text of an assistant's response, we must use `message.part.updated` events which carry `TextPart` objects with a `text` field, or call `client.session.messages()` API. The `CompletionContext.lastAssistantMessage` field is populated by the `message.part.updated` tracking in Task 11 (not from `message.updated`).

  **Files**: `src/features/workflow/completion.ts`
  **Acceptance**: Each completion method correctly detects its condition:
  - `user_confirm`: detects "confirmed"/"approved"/"continue"/"done"/"let's proceed" in user messages
  - `plan_created`: checks for plan file existence via `findPlans()`
  - `plan_complete`: uses `getPlanProgress().isComplete`
  - `review_verdict`: detects `[APPROVE]` or `[REJECT]` in last assistant message text (matches Weft/Warp output format). The text comes from accumulated `TextPart`s, NOT from `message.updated` events.
  - `agent_signal`: detects `<!-- workflow:step-complete -->` marker in assistant text parts

  ```typescript
  export interface CompletionCheckResult {
    complete: boolean
    verdict?: "approve" | "reject"
    artifacts?: Record<string, string>
    /** Concise summary of step output for context threading */
    summary?: string
    reason?: string
  }

  export interface CompletionContext {
    /** The last assistant message text (for review_verdict, agent_signal) */
    lastAssistantMessage?: string
    /** The last user message text (for user_confirm) */
    lastUserMessage?: string
    /** Working directory */
    directory: string
    /** The completion config from the step definition */
    config: CompletionConfig
    /** Current artifacts in the instance */
    artifacts: Record<string, string>
  }

  export function checkStepCompletion(
    method: CompletionMethod,
    context: CompletionContext,
  ): CompletionCheckResult
  ```

- [x] 6. Create workflow engine (state machine)
  **What**: The core engine that manages workflow instance lifecycle. Methods: `startWorkflow()`, `advanceStep()`, `pauseWorkflow()`, `resumeWorkflow()`, `skipStep()`, `abortWorkflow()`, `checkCurrentStep()`. The engine is stateless — it reads instance state from disk, computes transitions, writes state back. No in-memory singleton. The key difference from the original plan: `startWorkflow()` now takes a `goal` parameter, and `advanceStep()` captures step summaries for context threading. The engine also manages the active-instance pointer automatically.
  **Files**: `src/features/workflow/engine.ts`
  **Acceptance**: Full state machine works:
  - `startWorkflow(definition, goal, sessionId)` creates instance, sets active pointer, activates first step, returns context-threaded prompt for first step
  - `advanceStep(directory, completionResult)` marks current step complete (stores artifacts + summary), activates next step, returns context-threaded prompt for next step
  - `pauseWorkflow(directory, reason?)` sets instance status to paused
  - `resumeWorkflow(directory)` re-activates current step, returns context-threaded prompt
  - `skipStep(directory)` skips current step, advances to next
  - `abortWorkflow(directory)` cancels the instance, clears active pointer
  - `checkCurrentStep(directory, context)` evaluates completion conditions and returns transition actions
  - Completed/failed workflows clear the active pointer automatically

  ```typescript
  export interface EngineAction {
    type: "inject_prompt" | "switch_agent" | "pause" | "complete" | "none"
    /** Context-threaded prompt to inject */
    prompt?: string
    /** Agent to switch to for the next step */
    agent?: string
    reason?: string
  }

  export function startWorkflow(input: {
    definition: WorkflowDefinition
    definitionPath: string
    goal: string
    sessionId: string
    directory: string
  }): EngineAction

  export function checkAndAdvance(input: {
    directory: string
    context: CompletionContext
  }): EngineAction

  export function pauseWorkflow(directory: string, reason?: string): boolean
  export function resumeWorkflow(directory: string): EngineAction
  export function skipStep(directory: string): EngineAction
  export function abortWorkflow(directory: string): boolean
  ```

- [x] 7. Create workflow index module
  **What**: Create the barrel export file for the workflow feature.
  **Files**: `src/features/workflow/index.ts`
  **Acceptance**: All public types and functions are exported.

- [x] 8. Create `/run-workflow` slash command
  **What**: Add a new builtin command `"run-workflow"` to `BUILTIN_COMMANDS`. The command template should include `<session-context>` for session ID injection and `<user-request>` for the workflow name + goal argument. The command initially routes to `loom` (which will be overridden by the workflow engine's step agent). The argument format is: `<workflow-name> ["goal description"]` — the workflow name is required for new instances, optional for resume.
  **Files**: `src/features/builtin-commands/commands.ts`, `src/features/builtin-commands/types.ts`, `src/features/builtin-commands/templates/run-workflow.ts`
  **Acceptance**: Command appears in OpenCode's `/` command list. Template correctly passes workflow name and goal as arguments.

  ```typescript
  // types.ts — extend BuiltinCommandName
  export type BuiltinCommandName = "start-work" | "token-report" | "metrics" | "run-workflow"

  // templates/run-workflow.ts
  export const RUN_WORKFLOW_TEMPLATE = `You are being activated by the /run-workflow command to execute a multi-step workflow.

  ## Your Mission
  The workflow engine will inject context below with:
  - The workflow definition to use
  - The user's goal for this workflow instance
  - The current step and its prompt
  - Context from any previously completed steps

  Follow the injected step prompt. When the step is complete, the workflow engine will
  automatically advance you to the next step.

  ## Rules
  - Focus on the current step's task only
  - Signal completion clearly (the workflow engine detects it)
  - Do NOT skip ahead to future steps
  - If you need user input, ask for it and wait`
  ```

  ```typescript
  // commands.ts — add to BUILTIN_COMMANDS
  "run-workflow": {
    name: "run-workflow",
    description: "Run a multi-step workflow",
    agent: "loom",
    template: `<command-instruction>\n${RUN_WORKFLOW_TEMPLATE}\n</command-instruction>\n<session-context>Session ID: $SESSION_ID  Timestamp: $TIMESTAMP</session-context>\n<user-request>$ARGUMENTS</user-request>`,
    argumentHint: "<workflow-name> [\"goal\"]",
  }
  ```

- [x] 9. Create workflow hook handler
  **What**: Create a hook function (similar to `handleStartWork`) that detects the `/run-workflow` command in `chat.message`, parses the arguments into workflow name + optional goal, loads the workflow definition, and either creates a new instance or resumes an existing one. Also create a workflow continuation function (similar to `checkContinuation`) that checks workflow instance state on `session.idle` and advances the workflow.

  **Critical: `WORKFLOW_CONTINUATION_MARKER`**: Every prompt injected by `checkWorkflowContinuation` MUST include a `WORKFLOW_CONTINUATION_MARKER` (e.g., `<!-- weave:workflow-continuation -->`) so the auto-pause guard in `plugin-interface.ts` can recognize it and NOT pause coexisting WorkState plans. This follows the same pattern as `CONTINUATION_MARKER` in `work-continuation.ts`. The marker is defined in `hook.ts` and exported for use in `plugin-interface.ts`.

  **Critical: Invocation semantics (from Design section):**
  - `handleRunWorkflow` must parse the argument string to extract `workflowName` and `goal`
  - Argument format: `<workflow-name> "goal text"` or `<workflow-name>` or empty
  - If goal is provided and no active instance for this definition → create new instance
  - If no goal and active instance exists for this definition → resume it
  - If no args and any active instance exists → resume it
  - If no args and no active instance → list available definitions

  **Critical: Context threading integration:**
  - When starting a new instance, the hook composes the first step's context-threaded prompt (via `composeStepPrompt`)
  - When resuming, it composes the current step's context-threaded prompt with all prior context
  - The `checkWorkflowContinuation` function also uses `composeStepPrompt` when advancing to the next step

  **Files**: `src/features/workflow/hook.ts`
  **Acceptance**:
  - `/run-workflow secure-feature "Add OAuth2 login"` loads the workflow, creates instance with goal, injects first step's context-threaded prompt, switches to first step's agent
  - `/run-workflow secure-feature` with active instance resumes it
  - `/run-workflow` with active instance resumes it
  - `/run-workflow` with no active instance lists available definitions
  - Session idle with active workflow instance checks step completion and advances with context-threaded prompts
  - Interactive steps don't auto-advance on idle
  - Gate steps detect APPROVE/REJECT correctly
  - Autonomous steps auto-advance when completion condition is met
  - Every continuation prompt includes `WORKFLOW_CONTINUATION_MARKER`

  ```typescript
  /** Marker embedded in workflow continuation prompts so the auto-pause guard skips them. */
  export const WORKFLOW_CONTINUATION_MARKER = "<!-- weave:workflow-continuation -->"

  export interface WorkflowHookResult {
    contextInjection: string | null
    switchAgent: string | null
  }

  /** Parse /run-workflow arguments into workflow name and optional goal */
  export function parseWorkflowArgs(args: string): {
    workflowName: string | null
    goal: string | null
  }

  export function handleRunWorkflow(input: {
    promptText: string
    sessionId: string
    directory: string
  }): WorkflowHookResult

  export function checkWorkflowContinuation(input: {
    sessionId: string
    directory: string
    lastAssistantMessage?: string
  }): { continuationPrompt: string | null; switchAgent: string | null }
  ```

- [x] 10. Wire workflow hooks into createHooks
  **What**: Add `workflowStart` and `workflowContinuation` to the `createHooks()` return object. Guard with `isHookEnabled("workflow")` (enabled by default, same pattern as other hooks). The workflow continuation needs the `lastAssistantMessage` parameter (unlike work-continuation which just checks file state), so its signature differs from work-continuation. Note: `WORKFLOW_CONTINUATION_MARKER` is exported from `hook.ts` and will be imported by `plugin-interface.ts` for the auto-pause guard — no changes needed in `createHooks` for that.
  **Files**: `src/hooks/create-hooks.ts`
  **Acceptance**: Hooks are created when "workflow" hook is enabled (default: enabled), null when disabled. Follows existing pattern of other hooks.

  ```typescript
  // In createHooks return object:
  workflowStart: isHookEnabled("workflow")
    ? (promptText: string, sessionId: string) =>
        handleRunWorkflow({ promptText, sessionId, directory })
    : null,

  workflowContinuation: isHookEnabled("workflow")
    ? (sessionId: string, lastAssistantMessage?: string) =>
        checkWorkflowContinuation({ sessionId, directory, lastAssistantMessage })
    : null,
  ```

- [x] 11. Wire workflow into plugin-interface
  **What**: Integrate workflow hooks into `createPluginInterface()`:
  - In `chat.message`: detect `/run-workflow` command (similar to `/start-work` detection — check for `<session-context>` tag and a workflow-specific marker like the command instruction text), call `handleRunWorkflow()`, apply context injection and agent switch
  - In `event` handler for `session.idle`: call `checkWorkflowContinuation()`, inject continuation prompt if returned (using `client.session.promptAsync()`), include agent switch via the `agent` field in the `promptAsync` body
  - Handle user interrupts (tui.command.execute → session.interrupt) by pausing the workflow instance
  - **Critical: Auto-pause guard update**: Extend the auto-pause guard (lines 131-141) to recognize `WORKFLOW_CONTINUATION_MARKER` from `src/features/workflow/hook.ts`. Add `const isWorkflowContinuation = promptText.includes(WORKFLOW_CONTINUATION_MARKER)` and update the condition to: `if (!isStartWork && !isContinuation && !isWorkflowContinuation)`. This prevents workflow step transitions from auto-pausing coexisting `/start-work` plans.
  - **Critical coexistence**: The workflow idle handler must check `getActiveWorkflowInstance()` FIRST. If a workflow instance is active, it owns the idle loop — skip work-continuation to prevent double-prompting. Only fall through to work-continuation if no workflow instance is active.
  - **Critical: Message tracking via `message.part.updated`**: The `message.updated` event does NOT carry message text content (only metadata like tokens, cost). To get assistant message text for completion detection (`review_verdict`, `agent_signal`), track `message.part.updated` events instead. When a `TextPart` with `type: "text"` arrives for an assistant message, accumulate the text per `(sessionID, messageID)`. On `session.idle`, resolve the last assistant message's text from the accumulated parts and pass it to `checkWorkflowContinuation()`.

  **Verified SDK types for agent switching on `promptAsync`**:
  ```typescript
  // From @opencode-ai/sdk SessionPromptAsyncData:
  body?: {
    messageID?: string;
    model?: { providerID: string; modelID: string; };
    agent?: string;        // ← CONFIRMED: pass agent display name here
    noReply?: boolean;
    system?: string;
    tools?: { [key: string]: boolean; };
    parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
  }
  ```

  **Files**: `src/plugin/plugin-interface.ts`
  **Acceptance**: End-to-end: `/run-workflow` triggers workflow start with goal, idle events drive step transitions with context-threaded prompts, agent switching works per step (via `promptAsync` body `agent` field), workflow instance state persists across sessions.

  Implementation sketch for the auto-pause guard update:
  ```typescript
  // Import the workflow marker alongside the existing one
  import { WORKFLOW_CONTINUATION_MARKER } from "../features/workflow/hook"

  // In the auto-pause guard section of chat.message:
  const isStartWork = promptText.includes("<session-context>")
  const isContinuation = promptText.includes(CONTINUATION_MARKER)
  const isWorkflowContinuation = promptText.includes(WORKFLOW_CONTINUATION_MARKER)

  if (!isStartWork && !isContinuation && !isWorkflowContinuation) {
    const state = readWorkState(directory)
    if (state && !state.paused) {
      pauseWork(directory)
      log("[work-continuation] Auto-paused: user message received during active plan", { sessionId: sessionID })
    }
  }
  ```

  Implementation sketch for message text tracking via `message.part.updated`:
  ```typescript
  // Track assistant message text parts per session for workflow completion detection.
  // We accumulate text from message.part.updated events (TextPart) because
  // message.updated events do NOT carry message content — AssistantMessage only has
  // metadata (tokens, cost, model, etc.).
  const lastAssistantMessageText = new Map<string, string>()
  const assistantMessageParts = new Map<string, Map<string, string[]>>()

  // In event handler for message.part.updated:
  if (event.type === "message.part.updated") {
    const evt = event as {
      type: string
      properties: { part: { type: string; sessionID: string; messageID: string; text?: string } }
    }
    const part = evt.properties?.part
    if (part?.type === "text" && part.sessionID && part.messageID && part.text) {
      // Track this text part — we'll resolve the full message on session.idle
      let sessionParts = assistantMessageParts.get(part.sessionID)
      if (!sessionParts) {
        sessionParts = new Map()
        assistantMessageParts.set(part.sessionID, sessionParts)
      }
      let msgParts = sessionParts.get(part.messageID)
      if (!msgParts) {
        msgParts = []
        sessionParts.set(part.messageID, msgParts)
      }
      // TextPart updates replace, so track by part.id or just take latest text
      lastAssistantMessageText.set(part.sessionID, part.text)
    }
  }
  ```

  Implementation sketch for the idle handler with agent switching:
  ```typescript
  // In event handler for session.idle:
  if (hooks.workflowContinuation && event.type === "session.idle") {
    const sessionId = evt.properties?.sessionID ?? ""
    if (sessionId) {
      const lastMsg = lastAssistantMessageText.get(sessionId) ?? undefined
      const result = hooks.workflowContinuation(sessionId, lastMsg)
      if (result.continuationPrompt && client) {
        await client.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: result.continuationPrompt }],
            // Agent switching via promptAsync body — verified in SDK types
            ...(result.switchAgent
              ? { agent: getAgentDisplayName(result.switchAgent) }
              : {}),
          },
        })
        return // Don't fall through to work-continuation
      }
    }
  }
  // Existing work-continuation handler below...
  ```

  **Note for tests**: `plugin-interface.test.ts` will need new test cases for:
  - Workflow continuation prompt injection with agent switching
  - Auto-pause guard recognizing `WORKFLOW_CONTINUATION_MARKER`
  - `message.part.updated` text tracking
  - Coexistence: workflow idle handler preempts work-continuation
  Add these to Task 13's test list.

- [x] 12. Add workflow control sub-commands
  **What**: Handle workflow control commands within user messages during an active workflow. When a user types certain phrases, the workflow engine should respond:
  - "workflow pause" / "pause workflow" → pauses the workflow instance
  - "workflow skip" / "skip step" → skips current step
  - "workflow abort" / "abort workflow" → cancels the workflow instance, clears active pointer
  - "workflow status" → shows current instance state (goal, current step, progress, artifacts)
  - "continue" / "proceed" / "approved" → for interactive steps, signals completion
  These are NOT separate slash commands — they're keyword detection in `chat.message` during active workflows. This keeps the UX natural (user just types in chat).
  **Files**: `src/features/workflow/commands.ts` (keyword definitions + handler), integrate into `hook.ts`
  **Acceptance**: Keywords are detected correctly. "workflow pause" pauses the instance, "workflow skip" skips, etc. Keywords are only active when a workflow instance is running. "workflow status" includes the goal and current step context.

  ```typescript
  export interface WorkflowCommandResult {
    handled: boolean
    contextInjection?: string
    switchAgent?: string
  }

  /** Check if a user message contains a workflow control keyword */
  export function handleWorkflowCommand(
    message: string,
    directory: string,
  ): WorkflowCommandResult
  ```

  The "workflow status" response should use context threading to show the full instance state:
  ```
  ## Workflow Status: secure-feature
  **Goal**: "Add OAuth2 login with Google and GitHub providers"
  **Instance**: wf_a1b2c3d4
  **Status**: running

  ### Steps
  - [✓] Gather Requirements → "Users need Google and GitHub OAuth2 login..."
  - [✓] Create Plan → plan at .weave/plans/add-oauth2-login.md
  - [→] Plan Review (active)
  - [ ] Execute Plan
  - [ ] Code Review
  - [ ] Security Audit
  ```

- [x] 13. Write unit tests for workflow engine
  **What**: Comprehensive unit tests for all workflow modules:
  - Schema validation (valid/invalid definitions)
  - Instance storage (create/read/write/clear/round-trip, active pointer, slug generation, instance ID generation)
  - Discovery (multi-location, deduplication, invalid files skipped)
  - Context composer (first step context, mid-workflow context, all template variables, missing artifacts, step history formatting)
  - Completion detection (each method, edge cases)
  - Engine state machine (all transitions, instance lifecycle, active pointer management, context-threaded prompt generation)
  - Hook handler (argument parsing, new instance creation with goal, resume semantics, list definitions, `WORKFLOW_CONTINUATION_MARKER` present in all continuation prompts)
  - Plugin-interface integration (add to `plugin-interface.test.ts`):
    - Workflow continuation prompt injection with agent switching via `promptAsync` body `agent` field
    - Auto-pause guard recognizes `WORKFLOW_CONTINUATION_MARKER` (does NOT pause WorkState)
    - `message.part.updated` text tracking populates `lastAssistantMessageText`
    - Coexistence: workflow idle handler preempts work-continuation when workflow is active
  **Files**: `src/features/workflow/schema.test.ts`, `src/features/workflow/storage.test.ts`, `src/features/workflow/discovery.test.ts`, `src/features/workflow/context.test.ts`, `src/features/workflow/completion.test.ts`, `src/features/workflow/engine.test.ts`, `src/features/workflow/hook.test.ts`, `src/plugin/plugin-interface.test.ts` (MODIFY — add workflow-related cases)
  **Acceptance**: All tests pass. Coverage for happy paths and error cases. Context threading tests verify that each step receives the correct accumulated context.

- [ ] 14. Write integration/e2e test for full workflow lifecycle
  **What**: An end-to-end test that exercises the complete workflow instance lifecycle:
  1. Create a workflow definition file (JSONC)
  2. `/run-workflow secure-feature "Add OAuth2 login"` creates an instance with that goal
  3. Verify instance state has correct goal, slug, instance_id
  4. First step (interactive) activates with correct agent, prompt includes goal
  5. User confirmation advances to step 2
  6. Step 2 (autonomous) activates with agent switch, prompt includes prior step summary
  7. Completion condition met → advances to step 3 with full context
  8. Step 3 (gate) runs review, APPROVE → advances
  9. Workflow completes, active pointer is cleared
  Also test: pause/resume with context preservation, skip, abort, session resume (new session resumes instance with full context threading), argument parsing for various invocation formats.
  **Files**: `src/workflow-engine.test.ts`
  **Acceptance**: Full lifecycle test passes. Tests run in isolated temp directories with real file I/O (no mocks). Context threading is verified at each step transition.

- [x] 15. Add workflow config to WeaveConfig schema
  **What**: Add a `workflows` section to the WeaveConfig schema for workflow-related settings (e.g., disabled workflows, default workflow). This is minimal — just enough to allow users to disable specific workflows.
  **Files**: `src/config/schema.ts`
  **Acceptance**: Schema validates correctly. Existing configs without `workflows` field still validate.

  ```typescript
  export const WorkflowConfigSchema = z.object({
    disabled_workflows: z.array(z.string()).optional(),
  })

  // Add to WeaveConfigSchema:
  // workflows: WorkflowConfigSchema.optional(),
  ```

- [x] 16. Create example workflow definition files
  **What**: Create 2-3 example workflow definition files that users can reference:
  1. `secure-feature.jsonc` — the full plan→review→build→review workflow from the design section, with `{{instance.goal}}` and `{{instance.slug}}` template variables demonstrating context threading
  2. `quick-fix.jsonc` — a simpler 2-step workflow (fix → review), showing minimal workflow usage
  Place in `docs/examples/workflows/` (documentation, not loaded by discovery).
  **Files**: `docs/examples/workflows/secure-feature.jsonc`, `docs/examples/workflows/quick-fix.jsonc`
  **Acceptance**: Files are valid JSONC and pass the Zod schema validation. Template variables use the `instance.*` and `artifacts.*` namespaces correctly.

### Phase 2 (Deferred — NOT in scope)

These are explicitly deferred to keep Phase 1 deliverable:

- Conditional steps (skip step if condition not met)
- Parallel steps (run Weft and Warp simultaneously)
- Workflow composition (one workflow references another)
- UI rendering in OpenCode web app (SolidJS workflow progress panel)
- Workflow version migration (upgrading a definition while a workflow is in progress)
- Step retry with backoff
- Step timeout
- Workflow-level artifacts stored on disk (Phase 1 uses in-state strings only)
- Custom completion methods (user-defined plugins)
- Multi-instance concurrency (running two instances simultaneously)
- Instance archival/cleanup commands

## File Map

```
src/features/workflow/
├── types.ts               # TypeScript interfaces: WorkflowInstance, StepState, etc.
├── schema.ts              # Zod validation schemas for JSONC definitions
├── constants.ts           # File paths, directory constants
├── storage.ts             # Instance CRUD: create/read/write/clear + active pointer
├── discovery.ts           # Find workflow definitions from filesystem
├── context.ts             # Context composer + template resolver (NEW — was template.ts)
├── completion.ts          # Step completion detection per method
├── engine.ts              # Core state machine logic (instance-aware)
├── commands.ts            # Workflow control keywords
├── hook.ts                # Hook handlers (start, continuation) with invocation semantics
├── index.ts               # Barrel exports
├── schema.test.ts         # Tests
├── storage.test.ts
├── discovery.test.ts
├── context.test.ts        # Context threading tests (NEW)
├── completion.test.ts
├── engine.test.ts
└── hook.test.ts

src/features/builtin-commands/
├── commands.ts            # Add "run-workflow" command (MODIFY)
├── types.ts               # Extend BuiltinCommandName (MODIFY)
└── templates/
    └── run-workflow.ts    # Command template (NEW)

src/hooks/
└── create-hooks.ts        # Wire workflow hooks (MODIFY)

src/plugin/
└── plugin-interface.ts    # Integrate workflow into plugin (MODIFY)

src/config/
└── schema.ts              # Add workflows config section (MODIFY)

src/workflow-engine.test.ts # E2E integration test (NEW)

docs/examples/workflows/
├── secure-feature.jsonc   # Example workflow (NEW)
└── quick-fix.jsonc        # Example workflow (NEW)
```

## Implementation Order

Tasks should be executed in this order due to dependencies:

1. **Types + Schema** (Task 1) — everything else depends on these
2. **Constants + Storage** (Task 2) — engine depends on persistence, includes instance ID + slug generation
3. **Discovery** (Task 3) — command needs to find workflows
4. **Context Composer** (Task 4) — engine uses this for context-threaded prompt generation
5. **Completion** (Task 5) — engine uses this for step transitions
6. **Engine** (Task 6) — the core, depends on 1-5
7. **Index** (Task 7) — barrel exports for everything above
8. **Command** (Task 8) — depends on types
9. **Hook** (Task 9) — depends on engine + discovery + context composer
10. **createHooks wiring** (Task 10) — depends on hook
11. **plugin-interface wiring** (Task 11) — depends on createHooks
12. **Control commands** (Task 12) — depends on engine + hook
13. **Unit tests** (Task 13) — write alongside or after each module
14. **E2E test** (Task 14) — after everything is wired
15. **Config schema** (Task 15) — low dependency, can be early
16. **Example files** (Task 16) — last, depends on schema being finalized

## Potential Pitfalls

1. **Double-prompting with work-continuation**: If a workflow step uses `plan_complete`, both the workflow continuation and work-continuation hooks might fire on `session.idle`. **Mitigation**: In `plugin-interface.ts`, check `getActiveWorkflowInstance()` first. If a workflow instance is active, skip work-continuation for that session. The workflow engine owns the idle loop. This is implemented as a `return` after the workflow continuation handler fires (see Task 11 sketch).

2. **Agent switching timing**: Agent switching works two ways: (1) mutating `output.message.agent` in `chat.message` for the initial `/run-workflow` command, and (2) passing the `agent` field in the `promptAsync` body for `session.idle` continuations. **Verified**: The SDK `SessionPromptAsyncData.body` type confirms `agent?: string` field exists. The current work-continuation code does NOT use this field (it doesn't need agent switching), but workflow continuations will. Pass `getAgentDisplayName(stepAgent)` as the `agent` value.

3. **YAML vs JSONC**: The codebase doesn't have a YAML parser. **Decision**: Use JSONC (already have `jsonc-parser`). Workflow files are `.jsonc` or `.json`. This is consistent with `weave-opencode.jsonc`.

4. **Completion detection reliability**: `review_verdict` depends on scanning text for `[APPROVE]`/`[REJECT]`. If the agent format changes, detection breaks. **Mitigation**: Use robust regex that handles whitespace and case variations. Also support the markers that Weft/Warp already emit.

5. **State file corruption**: If the process crashes mid-write of instance state, state could be corrupted. **Mitigation**: Use the same simple write pattern as `writeWorkState()` — JSON.stringify + writeFileSync is atomic enough for single-process use. `readWorkflowInstance()` returns null on parse failure.

6. **Interactive step completion ambiguity**: How does the engine know when an interactive conversation is "done"? The user might say "sounds good" (which should complete) or "sounds good but also add error handling" (which should NOT complete). **Mitigation**: Require explicit confirmation language. The step's prompt should instruct the agent to ask for explicit confirmation. Detection looks for "confirmed"/"approved"/"proceed"/"continue" as standalone signals, not embedded in longer requests.

7. **Context threading prompt size**: As workflows accumulate steps, the context header grows. For 6+ steps with detailed summaries, this could consume significant context window. **Mitigation**: Keep step summaries concise (enforced by the engine when capturing summaries — truncate to ~200 chars). The context header omits summaries for pending steps and uses one-line summaries for completed steps.

8. **Instance directory cleanup**: Completed instances remain on disk in `.weave/workflows/{id}/`. Over time this could accumulate. **Mitigation**: Phase 1 leaves cleanup manual. Phase 2 can add `workflow cleanup` or TTL-based auto-deletion.

9. **Goal extraction from arguments**: The `/run-workflow` argument parser needs to handle various formats: `secure-feature "Add OAuth2"`, `secure-feature 'Add OAuth2'`, `secure-feature Add OAuth2` (no quotes). **Mitigation**: Parse the first word as workflow name, everything after as goal text (stripping surrounding quotes if present). Keep it simple.

10. **Slug collisions**: Two different goals could produce the same slug. **Mitigation**: The slug is used for convenience (e.g., plan filenames) but is not a unique identifier — the `instance_id` is the real key. If a plan file already exists at the slug path, the step prompt should handle it (the agent will find the existing file and overwrite or use a different name).

11. **`message.updated` has no content** (RESOLVED): The SDK `AssistantMessage` type does not include a `content`/`text` field — only metadata (tokens, cost, model, timing). The plan originally assumed `info.content` could be read from `message.updated` events. **Resolution**: Use `message.part.updated` events instead, which carry `TextPart` objects with the actual `text` field. Track the last text part per session via a `Map<string, string>` and pass it to `checkWorkflowContinuation()` on `session.idle`. See Task 11 implementation sketch.

12. **Workflow continuations trigger auto-pause** (RESOLVED): Prompts injected by `checkWorkflowContinuation` via `promptAsync` flow through `chat.message`, where the auto-pause guard checks for `<session-context>` and `CONTINUATION_MARKER`. Without a marker, workflow continuations would auto-pause any coexisting WorkState plan. **Resolution**: Define `WORKFLOW_CONTINUATION_MARKER = "<!-- weave:workflow-continuation -->"` in `hook.ts`, include it in every continuation prompt, and extend the auto-pause guard to recognize it. See Tasks 9 and 11.

13. **`command.execute.before` usage** (CLARIFICATION): The Context section mentions `command.execute.before` as a hook point for injecting workflow data, but the plan does not add a handler for it in the workflow engine. This is intentional — workflow context injection happens in `chat.message` (where we can read the full prompt text and mutate agent/parts), not in `command.execute.before`. The existing `command.execute.before` usage (for `token-report` and `metrics` commands) is unrelated. The `/run-workflow` command works through `chat.message` detection, same as `/start-work`.

14. **`crypto.randomBytes` import style**: The codebase uses `crypto.randomUUID()` in `background-manager.ts` (via the global `crypto` object). For instance ID generation, use `import { randomBytes } from "node:crypto"` (explicit Node.js import) since `randomBytes` is not available on the global `crypto` in all environments. This matches standard Node.js import conventions used elsewhere in the codebase.

15. **`isHookEnabled("workflow")` default**: The workflow hook is enabled by default (same as work-continuation). Users can opt out by setting `"hooks": { "workflow": false }` in their Weave config. This follows the existing pattern — no explicit documentation is needed beyond what's in `create-hooks.ts`.

## Verification
- [ ] `bun test` passes with no failures
- [ ] `bun run build` succeeds with no type errors
- [ ] Workflow instance state is created at `.weave/workflows/{id}/state.json` when `/run-workflow` runs with a goal
- [ ] Active pointer at `.weave/workflows/active-instance.json` tracks the running instance
- [ ] Context threading works: step 3's prompt includes the goal AND summaries from steps 1-2
- [ ] Agent switching works: each step activates with its configured agent
- [ ] Interactive steps wait for user input before advancing
- [ ] Autonomous steps advance automatically on `session.idle`
- [ ] Gate steps detect APPROVE/REJECT and act accordingly
- [ ] Workflow survives session restart (instance state persists, `/run-workflow` resumes with full context)
- [ ] `/run-workflow secure-feature "goal"` creates a new instance
- [ ] `/run-workflow` with no args resumes an active instance
- [ ] Existing `/start-work` functionality is unaffected
- [ ] No new npm dependencies added
