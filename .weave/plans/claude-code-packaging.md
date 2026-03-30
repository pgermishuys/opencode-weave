# Claude Code Packaging Strategy & Onboarding Experience

## TL;DR

> **Summary**: Add a `weave` CLI binary to the existing `@opencode_weave/weave` npm package (Option C — single package, new CLI entry point). The CLI command `weave init --cli claude-code` generates a complete `weave-claude-plugin/` directory. The OpenCode plugin export is completely unchanged. The key technical challenges are: (1) adding a CLI build entry point that doesn't bundle OpenCode deps at runtime, (2) resolving the `AgentConfig` type boundary so agent code compiles for the CLI path, and (3) deciding whether hook scripts import from npm at runtime or bundle a self-contained runtime. Recommended: single-bundle runtime approach (`weave-runtime.mjs` inlined into the plugin dir) so the plugin is fully self-contained.
>
> **Estimated Effort**: L (depends on Phase 0 of multi-cli-support.md being done first)

---

## Context

This plan is the **implementation-level packaging companion** to [`multi-cli-support.md`](.weave/plans/multi-cli-support.md), which contains the full architecture: `WeaveCore`, `CLIAdapter` interface, per-CLI adapter designs, hook mapping tables, agent mapping tables, and the complete Phase 0–5 migration roadmap.

**Read multi-cli-support.md first.** This plan focuses exclusively on:
- How the npm package gains a CLI binary without breaking the existing OpenCode plugin export
- How the build system produces both outputs
- The `AgentConfig` type boundary resolution (simplest path)
- The hook runtime strategy decision (self-contained bundle)
- Concrete onboarding flows for each user persona
- Testing strategy for generated artifacts
- Incremental shipping milestones (MVP → full feature parity)

### Current State (v0.7.3)

```
@opencode_weave/weave
  ├── dist/index.js          ← single ESM bundle (OpenCode plugin)
  ├── dist/index.d.ts        ← TypeScript declarations
  package.json:
    main: "dist/index.js"
    exports: { ".": { import: "./dist/index.js" } }
    bin: (none)
    files: ["dist/"]
  build: bun bundler (single entrypoint src/index.ts) + tsc --emitDeclarationOnly
  externals: @opencode-ai/plugin, @opencode-ai/sdk, zod, jsonc-parser, picocolors
```

### Target State

```
@opencode_weave/weave
  ├── dist/index.js          ← unchanged OpenCode plugin bundle
  ├── dist/index.d.ts        ← unchanged declarations
  ├── dist/cli.js            ← NEW: CLI binary bundle (self-contained, no OpenCode deps)
  package.json:
    main: "dist/index.js"
    exports:
      ".":    { import: "./dist/index.js" }
      "./cli": { import: "./dist/cli.js" }
    bin: { "weave": "./dist/cli.js" }
    files: ["dist/"]
  build: two bundler runs (plugin + CLI)
```

---

## Objectives

### Deliverables
- [ ] `dist/cli.js` — CLI binary, executable, no `@opencode-ai/*` runtime deps
- [ ] `weave init --cli claude-code [--output <dir>]` command
- [ ] Complete `weave-claude-plugin/` generator producing all required files
- [ ] Self-contained `weave-runtime.mjs` bundled inside the generated plugin dir
- [ ] Hook scripts that import from `weave-runtime.mjs` (no npm install required at runtime)
- [ ] Onboarding documentation in generated `CLAUDE.md`
- [ ] Tests for generated plugin structure validity (no Claude Code binary needed)
- [ ] Tests for hook script stdin/stdout protocol correctness

### Non-Goals
- Copilot CLI adapter (tracked in multi-cli-support.md Phase 4)
- OpenCode config changes (zero regression requirement)
- WeaveCore refactoring (tracked in multi-cli-support.md Phase 1)
- Custom agent support in first version (builtins only)

---

## Section 1: Packaging Strategy (Option C Details)

### 1.1 `bin` Entry Without Breaking the Plugin Export

The existing plugin export (`dist/index.js`) stays 100% unchanged. The CLI is a **separate entry point** that produces `dist/cli.js`.

**package.json changes:**

```json
{
  "bin": {
    "weave": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./cli": {
      "import": "./dist/cli.js"
    }
  },
  "files": ["dist/"]
}
```

The `bin` field makes `weave` available globally when the package is installed with `-g`, and as `npx @opencode_weave/weave` without installing. The `./cli` export is optional but allows programmatic use by other tools.

The `dist/cli.js` file must start with a Node.js shebang:
```javascript
#!/usr/bin/env node
```

Bun bundler does not auto-add the shebang for CLI entry points — it must be explicitly set in the bundle config or prepended as a post-build step.

### 1.2 CLI Command Structure

```
weave <command> [options]

Commands:
  init    Generate CLI-specific plugin/config files

Options for `init`:
  --cli <target>       Target CLI: "claude-code" | "opencode" | "all"
  --output <dir>       Output directory (default: ./weave-claude-plugin)
  --force              Overwrite existing files without prompting
  --dry-run            Show what would be generated without writing files
  --version            Print Weave version

Examples:
  weave init --cli claude-code
  weave init --cli claude-code --output ./my-plugin
  weave init --cli claude-code --force
  npx @opencode_weave/weave init --cli claude-code
```

The `init` command is the primary (and initially only) CLI command. Future commands (`weave status`, `weave metrics`, `weave mcp-server`) can be added without changing the packaging structure.

### 1.3 CLI Entry Point: `src/cli/index.ts`

```typescript
// src/cli/index.ts
// #!/usr/bin/env node  ← added by build script as shebang comment

import { parseArgs } from 'node:util'
import { initCommand } from './commands/init.js'

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    cli: { type: 'string' },
    output: { type: 'string', default: './weave-claude-plugin' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    version: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (values.version) {
  // version is inlined at build time via define: { __VERSION__: JSON.stringify(version) }
  console.log(__VERSION__)
  process.exit(0)
}

const command = positionals[0]

if (command === 'init') {
  await initCommand({
    cli: values.cli ?? 'claude-code',
    output: values.output!,
    force: values.force!,
    dryRun: values['dry-run']!,
  })
} else {
  console.error(`Unknown command: ${command ?? '(none)'}`)
  console.error('Usage: weave init --cli claude-code [--output <dir>]')
  process.exit(1)
}
```

The CLI entry point imports **only** from `src/` paths that have zero `@opencode-ai/*` runtime dependencies. The OpenCode adapter (`src/plugin/`, `src/index.ts`) is **never imported** by the CLI path.

### 1.4 Build System Changes

**Updated `script/build.ts`:**

```typescript
// Build 1: OpenCode plugin bundle (unchanged)
const pluginResult = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  naming: 'index.js',
  target: 'node',
  format: 'esm',
  external: ['@opencode-ai/plugin', '@opencode-ai/sdk', 'zod', 'jsonc-parser', 'picocolors'],
  minify: false,
})

// Build 2: CLI binary bundle (new)
const cliResult = await Bun.build({
  entrypoints: ['./src/cli/index.ts'],
  outdir: './dist',
  naming: 'cli.js',
  target: 'node',
  format: 'esm',
  // Key: @opencode-ai/* are NOT externals here — they must not be imported
  // by the CLI path at all (enforced by import structure, not bundler config).
  // zod, jsonc-parser, picocolors ARE bundled in (no runtime dep for CLI users)
  external: [],
  define: {
    __VERSION__: JSON.stringify(require('./package.json').version),
  },
  banner: '#!/usr/bin/env node',
  minify: false,
})
```

**Important nuance**: The CLI bundle should have **no externals** — it bundles everything in (zod, jsonc-parser, picocolors, all Weave core logic). This makes `dist/cli.js` fully self-contained. Users can run `npx @opencode_weave/weave init` without any other packages installed. The bundle will be ~500KB-1MB — acceptable for a one-time generation command.

The **generated plugin's runtime** (`weave-runtime.mjs`) is a **separate bundle** produced during `weave init` execution at generation time (or pre-built and shipped in `dist/`). See Section 4.

**Build scripts in `package.json`:**

```json
{
  "scripts": {
    "build": "bun run script/build.ts && tsc --emitDeclarationOnly",
    "build:plugin": "bun run script/build.ts --only plugin",
    "build:cli": "bun run script/build.ts --only cli"
  }
}
```

### 1.5 What Goes in `dist/`

```
dist/
├── index.js           ← OpenCode plugin bundle (unchanged, ~150KB)
├── index.d.ts         ← TypeScript declarations (unchanged)
├── cli.js             ← CLI binary (self-contained, ~600KB)
└── weave-runtime.js   ← Pre-built core runtime for hook scripts (~400KB)
```

`weave-runtime.js` is pre-built and shipped with the package. When `weave init --cli claude-code` generates the plugin directory, it **copies** `weave-runtime.js` into `weave-claude-plugin/hooks/weave-runtime.mjs`. This avoids bundling core logic at init time.

**`package.json` files field** stays as `["dist/"]` — everything in `dist/` is published.

### 1.6 Runtime Dependencies of the CLI

The CLI binary (`dist/cli.js`) has zero runtime npm dependencies when bundled with `external: []`. It is a self-contained Node.js script.

The generated hook scripts (`hooks/*.mjs`) depend only on:
1. `weave-runtime.mjs` — copied into the plugin dir at `weave init` time
2. Node.js built-ins (`process`, `node:fs`, `node:path`)
3. Nothing from npm (no `node_modules` lookup at runtime)

This is the "single runtime bundle" strategy (Option C from the hook runtime section below).

---

## Section 2: The `AgentConfig` Type Boundary

### 2.1 The Problem

23 files in `src/agents/` import `type { AgentConfig }` from `@opencode-ai/sdk`. The CLI path calls `createBuiltinAgents()` to get agent definitions (for prompt content, model settings, tool permissions). This transitively imports the type.

Since all imports are `import type`, there is **zero runtime coupling** — TypeScript erases all type imports at build time. The question is purely about compilation and conceptual clarity.

### 2.2 Recommended Approach: Tolerate `import type` in CLI Path (Zero-Touch)

**Recommendation: Option B — The CLI can import the same code as-is. `import type` is erased at build time.**

Rationale:
- `import type { AgentConfig }` generates **no JavaScript output** — it is completely erased by tsc and Bun
- The CLI bundle will NOT contain any `@opencode-ai/sdk` code because it's a type-only import
- The `Bun.build()` bundler correctly excludes type-only imports from the bundle
- No files need to be touched immediately — all 23 files continue to compile

**Verification**: Build `dist/cli.js` with `external: []` and confirm `@opencode-ai/sdk` is not present in the bundle output. It will not be, because it's only ever imported as a type.

**Future migration** (tracked in multi-cli-support.md TODO #1): When Phase 0 of multi-cli-support.md is implemented, `WeaveAgentDefinition` replaces `AgentConfig` throughout core. That refactoring is a separate concern and is not required for Claude Code packaging to ship.

### 2.3 The Actual Runtime Boundary

The CLI path imports:
```
src/cli/index.ts
  → src/cli/commands/init.ts
    → src/adapters/claude-code/plugin-generator.ts
      → src/agents/builtin-agents.ts    ← uses import type AgentConfig (erased)
      → src/hooks/create-hooks.ts       ← zero OpenCode deps
      → src/config/loader.ts            ← zero OpenCode deps
      → src/features/builtin-commands/  ← zero OpenCode deps
```

At no point does the CLI path `import` (runtime import) anything from `@opencode-ai/plugin` or `@opencode-ai/sdk`. The types are erased. The bundle is clean.

**To guarantee this**: Add a CI check that runs `grep -r "opencode-ai" dist/cli.js` and asserts no matches (after the type-only boundary is verified at build time).

### 2.4 The `AgentConfig` Fields the CLI Actually Uses

The Claude Code adapter uses these fields from agent definitions to generate `.md` subagent files:

| Field used | Source in current code | Maps to |
|---|---|---|
| `prompt` | `AgentConfig.prompt` | YAML body of `agents/{name}.md` |
| `model` | `AgentConfig.model` | `model:` frontmatter field |
| `steps` / `maxSteps` | `AgentConfig.maxSteps` | `maxTurns:` frontmatter field |
| `tools` (permission map) | `AgentConfig.tools` | `tools:` or `disallowedTools:` frontmatter |
| display name | `AgentConfig.name` | `name:` frontmatter field (but use config key for file name) |

These are all plain values on the config object — no SDK methods called, no SDK types needed at runtime. The type is truly just a shape annotation.

---

## Section 3: Claude Code Plugin Generator

### 3.1 What `weave init --cli claude-code` Does

Step-by-step execution:

```
1. Load weave.json (or .opencode/weave-opencode.json for backward compat; or use defaults if neither present)
2. Validate output directory exists or create it
3. If output dir has existing plugin: show diff summary (unless --force)
4. Build WeaveCore-like agent definitions:
   a. Call createBuiltinAgents(options from weave.json)
   b. Apply disabledAgents filter
   c. Apply agentOverrides
5. Load builtin commands (BUILTIN_COMMANDS)
6. Generate each file (see below)
7. Copy weave-runtime.mjs from dist/ into hooks/
8. Print success message with install instructions
9. Print feature degradation report
```

### 3.2 File Generation Details

#### `agents/{name}.md` (8 files)

For each non-disabled agent, call `mapAgent(agentDef)`:

```typescript
function mapAgent(name: string, agent: AgentConfig): string {
  const frontmatter: Record<string, unknown> = {
    name,
    description: getAgentDescription(name),  // from AGENT_METADATA
  }

  if (agent.model) frontmatter.model = agent.model

  // maxTurns: use agent.maxSteps (or 30 for loom/tapestry, 10 for subagents as defaults)
  frontmatter.maxTurns = agent.maxSteps ?? getDefaultMaxTurns(name)

  // Tool restrictions from permission config or known agent roles
  const toolConfig = getAgentToolConfig(name, agent)
  if (toolConfig.tools) frontmatter.tools = toolConfig.tools
  if (toolConfig.disallowedTools) frontmatter.disallowedTools = toolConfig.disallowedTools

  // color from agent config (nice-to-have)
  if (agent.color) frontmatter.color = agent.color

  // MUST NOT include: hooks, mcpServers, permissionMode
  // (security restriction: plugin subagents cannot override these)

  const yamlBody = formatYamlFrontmatter(frontmatter)
  const promptBody = agent.prompt ?? ''

  return `---\n${yamlBody}---\n\n${promptBody}\n`
}
```

**Tool config by agent** (hardcoded in adapter, not in core):

| Agent | `tools` | `disallowedTools` |
|---|---|---|
| loom | (none — default full access) | — |
| tapestry | (none — default full access) | — |
| pattern | `[Read, Glob, Grep, Write]` | — |
| thread | — | `[Write, Edit, MultiEdit, Bash]` |
| spindle | — | `[Write, Edit, MultiEdit, Bash]` |
| weft | — | `[Write, Edit, MultiEdit, Bash]` |
| warp | — | `[Write, Edit, MultiEdit, Bash]` |
| shuttle | (none — category dispatch decides) | — |

**Note**: Pattern gets `tools: [Read, Glob, Grep, Write]` (allowlist). Write is allowed but constrained by the `PreToolUse` hook to `.md` files in `.weave/plans/`. Thread/Spindle/Weft/Warp get a denylist (`disallowedTools`) for write operations — they are read-only agents.

#### `skills/start-work/SKILL.md`, `skills/run-workflow/SKILL.md`, `skills/metrics/SKILL.md`

> **Naming note**: This plan uses `skills/run-workflow/SKILL.md` to match the actual command name (`run-workflow`). The parent plan `multi-cli-support.md` uses `skills/plan/SKILL.md` — that is inconsistent and the parent plan should be updated to use `run-workflow` as well.

For each builtin command, call `mapCommand(cmd)`:

```typescript
function mapCommand(cmd: BuiltinCommand): string | null {
  // Only expose commands that make sense as Claude Code skills
  const exposedCommands = new Set(['start-work', 'metrics', 'run-workflow'])
  if (!exposedCommands.has(cmd.name)) return null

  const frontmatter = {
    name: cmd.name,
    description: cmd.description,
  }

  // Derive skill body from the command template.
  // Template uses $SESSION_ID, $TIMESTAMP, $ARGUMENTS — skill files use $ARGUMENTS.
  // Strip the XML wrapper and session-context, keep the instruction body.
  const skillBody = deriveSkillBody(cmd.template)

  return `---\n${formatYamlFrontmatter(frontmatter)}---\n\n${skillBody}\n`
}
```

Skills are invoked as `/weave:start-work`, `/weave:run-workflow`, `/weave:metrics` (namespaced by plugin name).

**`token-report`** command is NOT exposed as a skill — it's an internal command triggered by the analytics system, not user-invocable.

#### `hooks/hooks.json`

Generated statically (does not depend on weave.json config):

```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs\"" }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.mjs\"" }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.mjs\"" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-stop.mjs\"" }]
    }],
    "SubagentStop": [{
      "matcher": "tapestry",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-stop.mjs\"" }]
    }],
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/on-session-start.mjs\"" }]
    }],
    "PreCompact": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.mjs\"" }]
    }],
    "PostCompact": [{
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/post-compact.mjs\"" }]
    }]
  }
}
```

**`${CLAUDE_PLUGIN_ROOT}`** is a Claude Code environment variable available to hook scripts — it resolves to the absolute path of the installed plugin directory. This avoids hardcoding paths.

#### `hooks/*.mjs` (7 files)

These are static template strings rendered into the output directory. They import from `./weave-runtime.mjs` (relative to `hooks/`). See Section 4 for the runtime strategy.

#### `settings.json`

```json
{ "agent": "loom" }
```

Static. Always the same. Makes Loom the default primary agent when Claude Code launches with this plugin.

#### `.claude-plugin/plugin.json`

```json
{
  "name": "weave",
  "version": "${WEAVE_VERSION}",
  "description": "Weave — 8-agent AI orchestration system for Claude Code",
  "author": "opencode_weave"
}
```

The version is injected from the CLI's `__VERSION__` constant (set at build time via Bun's `define`).

#### `CLAUDE.md`

Project context document. Contains:
1. What Weave is (1 paragraph)
2. The 8 agents: name, role, invocation pattern (`@weave:pattern`, `@weave:thread`, etc.)
3. Available skills: `/weave:start-work`, `/weave:run-workflow`, `/weave:metrics`
4. Where plan state lives: `.weave/state.json`, `.weave/plans/`
5. Agent delegation patterns (when Loom dispatches to subagents)
6. How continuation works (Tapestry auto-continues via Stop hook)
7. How to update (re-run `weave init --cli claude-code`, reinstall plugin)

This is generated with static content — no dynamic expansion from weave.json (CLAUDE.md doesn't change based on config). If custom agents are added in future, CLAUDE.md will need to mention them.

### 3.3 Output Message

After successful generation:

```
✓ Weave Claude Code plugin generated at ./weave-claude-plugin/

  Files created:
    .claude-plugin/plugin.json
    agents/loom.md, tapestry.md, pattern.md, thread.md,
           spindle.md, weft.md, warp.md, shuttle.md
    skills/start-work/SKILL.md, run-workflow/SKILL.md, metrics/SKILL.md
    hooks/hooks.json + 7 hook scripts
    hooks/weave-runtime.mjs  (WeaveCore runtime, 420KB)
    settings.json
    CLAUDE.md

  To install:
    /plugin install ./weave-claude-plugin

  For development (no install needed):
    claude --plugin-dir ./weave-claude-plugin

  Re-run this command only when weave.json changes.
  Hook scripts read live state from disk on every invocation — no restart needed.

Feature notes:
  ✓ All 8 agents as plugin subagents (full support)
  ✓ Work continuation via Stop/SubagentStop hooks (full support)
  ✓ Pattern-md-only write guard via PreToolUse hook (full support)
  ✗ Read-before-write guard — incompatible with subprocess invocation (see Section 4.5)
  ✓ Compaction recovery via PreCompact/PostCompact (better than OpenCode)
  ✗ Context window monitor — no token data in Claude Code hook payloads
  ✗ Todo sidebar integration — no Claude Code todo API
  ✗ Analytics token counts — tool-level only (no per-message token data)
```

---

## Section 4: Hook Script Runtime Strategy

### 4.1 The Decision

Three options:
- **A. Import at runtime**: `import { createWeaveCore } from '@opencode_weave/weave/core'` — requires npm install
- **B. Self-contained scripts**: All logic inlined per-script — large, not updatable without regeneration
- **C. Single runtime bundle**: `weave-runtime.mjs` in `hooks/`, all scripts import from it

**Recommendation: Option C — Single runtime bundle (`weave-runtime.mjs`).**

### 4.2 Why Option C

| Criterion | A (npm import) | B (inline per script) | C (runtime bundle) |
|---|---|---|---|
| Requires npm install in project | ✓ Yes — friction | ✗ No | ✗ No |
| Works in projects without package.json | ✗ No | ✓ Yes | ✓ Yes |
| Works in team repos (committed plugin dir) | ✗ Fragile (version drift) | ✓ Yes | ✓ Yes |
| Script size | Tiny (1-2KB) | Large (50-100KB each) | Tiny + one 400KB bundle |
| Updatable via `weave init` re-run | ✓ Yes (but npm version may differ) | ✓ Yes | ✓ Yes |
| Single source of truth | ✓ npm package | ✗ Each script is a copy | ✓ One bundle |
| Cold start per hook invocation | Fastest (cached module) | Slow (re-parse) | Medium (one bundle parse) |
| Total plugin dir size | ~40KB | ~700KB | ~450KB |

**Option A is eliminated**: It requires `@opencode_weave/weave` to be in the project's `node_modules`. This breaks for new users, non-npm projects, and team members who haven't run `npm install`. The npm package is currently only required by OpenCode (which auto-installs it). Requiring it for Claude Code hook execution couples two use cases incorrectly.

**Option B is eliminated**: 7 scripts × ~80KB each = ~560KB of duplicated logic. Any bug fix requires regenerating. The scripts are harder to audit.

**Option C wins**: One `weave-runtime.mjs` (~400KB bundled) is copied into `hooks/` at `weave init` time. Hook scripts are tiny (10-20 lines each). To update, re-run `weave init --cli claude-code` — the new runtime bundle replaces the old one.

### 4.3 `weave-runtime.mjs` Build

Pre-built in `dist/weave-runtime.js` as part of the npm package build. This is the **third build target**:

```typescript
// Build 3: Hook runtime bundle (pre-built, shipped in dist/)
const runtimeResult = await Bun.build({
  entrypoints: ['./src/core/create-core.ts'],  // or ./src/runtime/index.ts
  outdir: './dist',
  naming: 'weave-runtime.js',
  target: 'node',
  format: 'esm',
  external: [],  // bundle everything — no runtime deps
  minify: false, // keep readable for debugging
})
```

This pre-built file is shipped in the npm package (`dist/weave-runtime.js`). When `weave init --cli claude-code` runs, it:
1. Locates `dist/weave-runtime.js` relative to the CLI binary location
2. Copies it to `{outputDir}/hooks/weave-runtime.mjs`

**Version locking**: The runtime bundle is versioned with the package. When users upgrade `@opencode_weave/weave` and re-run `weave init`, they get the updated runtime. The runtime version is embedded in the bundle as a comment header.

### 4.4 Hook Script Templates

Each hook script is a static string template (no dynamic content — they always import the same runtime):

```javascript
// hooks/pre-tool-use.mjs
// Generated by weave v${VERSION} — safe to commit
import { createWeaveCore } from './weave-runtime.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString())

try {
  const core = await createWeaveCore(process.cwd())
  const result = core.checkToolBefore(
    input.agent_name ?? '',
    input.tool_name ?? '',
    input.tool_input?.file_path ?? input.tool_input?.path ?? '',
    input.session_id ?? ''
  )

  if (!result.allowed) {
    process.stdout.write(JSON.stringify({
      permissionDecision: 'deny',
      reason: result.reason
    }))
    process.exit(2)
  }
} catch (err) {
  // Non-fatal: log error but allow tool to proceed
  process.stderr.write(`[weave] pre-tool-use error: ${err}\n`)
}
process.exit(0)
```

```javascript
// hooks/on-stop.mjs
// Generated by weave v${VERSION} — safe to commit
import { createWeaveCore } from './weave-runtime.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString())

try {
  const core = await createWeaveCore(process.cwd())

  // Guard: only Tapestry drives the continuation loop
  const agentName = input.agent_name ?? input.subagent_name ?? ''
  if (agentName && !core.isContinuationAgent(agentName)) {
    process.exit(0)
  }

  const result = core.handleWorkContinuation(input.session_id ?? '')
  if (result.shouldContinue) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: result.continuationPrompt
    }))
    process.exit(2)
  }
} catch (err) {
  process.stderr.write(`[weave] on-stop error: ${err}\n`)
}
process.exit(0)
```

```javascript
// hooks/post-compact.mjs
// Generated by weave v${VERSION} — safe to commit
import { createWeaveCore } from './weave-runtime.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString())

try {
  const core = await createWeaveCore(process.cwd())
  const result = await core.handlePostCompact(input.session_id ?? '')
  if (result.reOrientationContext) {
    process.stdout.write(JSON.stringify({
      additionalContext: result.reOrientationContext
    }))
  }
} catch (err) {
  process.stderr.write(`[weave] post-compact error: ${err}\n`)
}
process.exit(0)
```

**Error handling philosophy**: Hook scripts never crash the user's Claude Code session. All errors are caught, logged to stderr (which Claude Code shows as warnings), and exit 0 (allow). Only intentional blocks exit 2.

### 4.5 `createWeaveCore` for the Hook Runtime

The hook scripts call `createWeaveCore(process.cwd())`. This function is the CLI-agnostic core initializer (from multi-cli-support.md Phase 1). Until that refactoring is done, the runtime needs a **shim** that provides the required interface:

```typescript
// src/runtime/create-core.ts (temporary shim until WeaveCore is extracted)
export async function createWeaveCore(directory: string): Promise<WeaveCoreRuntime> {
  // Load weave.json config
  const config = await loadWeaveConfig(directory)
  // Build agents (with type erasure — AgentConfig fields used as plain values)
  const agents = createBuiltinAgents({ ...config, ... })
  // Create work state reader
  const workState = createWorkStateReader(directory)
  // Return runtime interface
  return {
    isContinuationAgent: (name) => name === 'tapestry',
    checkToolBefore: (agent, tool, path, session) => checkToolBeforeImpl(agent, tool, path, config),
    handleWorkContinuation: (session) => handleWorkContinuationImpl(workState, config, session),
    handlePreCompact: (session) => handlePreCompactImpl(workState, directory),
    handlePostCompact: (session) => handlePostCompactImpl(workState, directory),
  }
}
```

> **⚠️ Write guard scope in Claude Code adapter**: `checkToolBefore` in the Claude Code adapter implements **ONLY `checkPatternWrite()`** (the pattern-md-only guard) — it does NOT implement `checkWriteAllowed()` (the read-before-write guard from `src/hooks/write-existing-file-guard.ts`).
>
> **Reason**: The existing-file write guard relies on a per-session in-memory `readFiles: Set<string>` that tracks which files have been read in the current session. In Claude Code's subprocess hook model, each `pre-tool-use.mjs` invocation starts a fresh Node.js process with an empty set. This makes `checkWriteAllowed()` functionally broken in this context — it would always report a file as "not read" even if the agent had just read it in a previous tool call.
>
> **Claude Code users get**: Pattern agent is restricted to writing `.md` files in `.weave/plans/` only (full support).
>
> **Claude Code users do NOT get**: Read-before-write protection for existing files in other agents (not feasible with subprocess invocation).
>
> **Future enhancement**: Disk-based read tracking via a `PostToolUse` hook (writing a read-ledger to `.weave/read-ledger.json`) would enable stateful write guards across subprocess invocations. This is a potential Phase 2+ enhancement, not Phase 1.

This shim can be written as a pure function over existing logic without the full WeaveCore refactoring. It reads the same `.weave/state.json`, uses the same continuation logic from `src/hooks/work-continuation.ts`, and the same pattern write guard from `src/hooks/write-existing-file-guard.ts`.

**`isContinuationAgent` hardcoding is acceptable here**: Until the WeaveCore interface is formally defined, the shim hardcodes `tapestry`. The hook scripts call `core.isContinuationAgent()` rather than comparing to "tapestry" directly — so when WeaveCore is properly extracted, only the shim changes.

---

## Section 5: Onboarding Experience

### 5.1 Persona: New User (Never Used Weave)

**Goal**: Start using Weave's 8-agent system in Claude Code today.

**Steps**:
```bash
# Step 1: Generate the plugin (one command, no config needed)
npx @opencode_weave/weave init --cli claude-code

# Step 2: Install the plugin in Claude Code
# (inside Claude Code terminal or as flag)
/plugin install ./weave-claude-plugin
# OR:
claude --plugin-dir ./weave-claude-plugin

# Step 3: Start using it
# In Claude Code: type @weave:pattern to invoke the Pattern agent
# Or: /weave:start-work to start executing a plan
```

**What they get**: All 8 agents, write guards, continuation, compaction recovery, skills. No `weave.json` required — defaults apply.

**What they don't need**: npm install, `weave.json` config, Node.js version pinning (hooks use system Node.js).

**Time to first use**: ~2 minutes.

### 5.2 Persona: Existing OpenCode User

**Goal**: Add Claude Code support to a project that already uses Weave with OpenCode.

**Steps**:
```bash
# Already have weave.json and @opencode_weave/weave installed
# Step 1: Generate Claude Code plugin (reads existing weave.json)
npx @opencode_weave/weave init --cli claude-code

# Step 2: (optional) Commit the plugin to repo for team
git add weave-claude-plugin/
git commit -m "Add Weave Claude Code plugin"

# Step 3: Install in Claude Code
/plugin install ./weave-claude-plugin
```

**Key point**: Their `weave.json` config (disabled agents, overrides, custom agents) is respected. The generated `.md` files reflect their exact config. OpenCode plugin is completely unchanged.

**Config file compatibility**: New users create `weave.json` at the project root. Existing OpenCode users whose config lives at `.opencode/weave-opencode.json` are automatically supported (the config loader checks both paths; a deprecation notice prompts them to rename the file).

**After a `weave.json` change** (adding a new agent, changing model, etc.):
```bash
npx @opencode_weave/weave init --cli claude-code --force
/plugin install ./weave-claude-plugin   # reinstall to pick up changes
```

This is equivalent to the "restart OpenCode after config change" flow.

### 5.3 Persona: Team Setup

**Goal**: Weave available for all team members using Claude Code, without each person running `weave init`.

**Strategy**: Commit the generated plugin directory to the repository.

```bash
# One-time setup by project maintainer:
npx @opencode_weave/weave init --cli claude-code
git add weave-claude-plugin/
git commit -m "Add Weave Claude Code plugin for team"
git push

# Each team member:
git pull
/plugin install ./weave-claude-plugin
# OR add to their Claude Code startup config:
# claude --plugin-dir ./weave-claude-plugin
```

**Plugin directory is safe to commit**: The generated files are deterministic given the same `weave.json` and package version. The `weave-runtime.mjs` file (~400KB) is the largest file but is necessary for hook functionality. Teams can add `weave-claude-plugin/hooks/weave-runtime.mjs` to `.gitignore` if size is a concern and run `weave init --force` locally (scripts will then fail until re-run, but the agent `.md` files work without hooks).

**Updating Weave version for the team**:
```bash
npm install @opencode_weave/weave@latest  # or bun add ...
npx @opencode_weave/weave init --cli claude-code --force
git add weave-claude-plugin/
git commit -m "Update Weave Claude Code plugin to v0.x.y"
```

### 5.4 `.gitignore` Guidance

Generated in CLAUDE.md and printed after `weave init`:

```gitignore
# Optional: exclude generated plugin (each dev runs weave init)
# weave-claude-plugin/

# Optional: exclude large runtime bundle (requires weave init before use)
# weave-claude-plugin/hooks/weave-runtime.mjs

# Recommended: always exclude Weave state and analytics
.weave/state.json
.weave/analytics/
.weave/compaction-snapshot.json
```

**Recommendation**: Commit the plugin dir for teams. Exclude it for solo projects.

### 5.5 Update Flow

| Event | Action Required | Time |
|---|---|---|
| `weave.json` changed | Re-run `weave init --cli claude-code`, reinstall plugin | 1 min |
| New Weave version released | Upgrade package, re-run `weave init`, reinstall | 2 min |
| New session starts | Nothing — hook scripts auto-read live state | 0 |
| Plan state changes | Nothing — hooks read `.weave/state.json` live | 0 |
| New task in plan | Nothing | 0 |

---

## Section 6: Testing Strategy

### 6.1 Layer 0: Unit Tests (No Claude Code, No API Key)

**Scope**: Test each generator function in isolation.

```
src/adapters/claude-code/
├── agent-mapper.test.ts          ← mapAgent() for each of 8 agents
├── skill-mapper.test.ts          ← mapCommand() for each builtin command
├── hook-generator.test.ts        ← hooks.json structure, script template rendering
├── plugin-generator.test.ts      ← end-to-end generateConfig() output
└── runtime-shim.test.ts          ← createWeaveCore() interface correctness
```

Key assertions:
- `mapAgent("pattern", ...)` produces `tools: [Read, Glob, Grep, Write]` in frontmatter
- `mapAgent("thread", ...)` produces `disallowedTools: [Write, Edit, MultiEdit, Bash]`
- No generated agent file contains `hooks:` or `mcpServers:` or `permissionMode:` fields
- `mapCommand("start-work", ...)` produces non-empty skill body derived from template (not hardcoded)
- `hooks.json` has exactly 8 hook registrations
- All hook commands reference `${CLAUDE_PLUGIN_ROOT}`
- `settings.json` is `{ "agent": "loom" }`

### 6.2 Layer 1: Plugin Structure Validation (No Claude Code, No API Key)

**Scope**: Run `generateConfig()` against a temp project, validate the complete output.

```typescript
// src/test-utils/plugin-validator.ts

export async function validatePluginDir(pluginDir: string): Promise<ValidationResult> {
  const errors: string[] = []

  // Required files
  const required = [
    '.claude-plugin/plugin.json',
    'agents/loom.md', 'agents/tapestry.md', 'agents/pattern.md',
    'agents/thread.md', 'agents/spindle.md', 'agents/weft.md',
    'agents/warp.md', 'agents/shuttle.md',
    'hooks/hooks.json',
    'hooks/pre-tool-use.mjs', 'hooks/on-stop.mjs', 'hooks/post-tool-use.mjs',
    'hooks/user-prompt-submit.mjs', 'hooks/on-session-start.mjs',
    'hooks/pre-compact.mjs', 'hooks/post-compact.mjs',
    'settings.json',
    'CLAUDE.md',
  ]
  for (const f of required) {
    if (!existsSync(join(pluginDir, f))) errors.push(`Missing required file: ${f}`)
  }

  // Validate each agent .md file
  for (const agent of ['loom', 'tapestry', 'pattern', 'thread', 'spindle', 'weft', 'warp', 'shuttle']) {
    const result = validateSubagentMd(join(pluginDir, `agents/${agent}.md`))
    errors.push(...result.errors.map(e => `agents/${agent}.md: ${e}`))
  }

  // Validate hooks.json
  const hooksResult = validateHooksJson(join(pluginDir, 'hooks/hooks.json'))
  errors.push(...hooksResult.errors)

  return { valid: errors.length === 0, errors }
}

export function validateSubagentMd(filePath: string): ValidationResult {
  const errors: string[] = []
  const content = readFileSync(filePath, 'utf-8')
  const frontmatter = parseFrontmatter(content)

  // Required fields
  if (!frontmatter.name) errors.push('Missing required frontmatter field: name')
  if (!frontmatter.description) errors.push('Missing required frontmatter field: description')

  // Forbidden fields (security restriction)
  const forbidden = ['hooks', 'mcpServers', 'permissionMode']
  for (const field of forbidden) {
    if (field in frontmatter) errors.push(`Forbidden frontmatter field present: ${field}`)
  }

  // Body must not be empty
  const body = content.split('---').slice(2).join('---').trim()
  if (!body) errors.push('Empty prompt body')

  return { valid: errors.length === 0, errors }
}
```

### 6.3 Layer 2: Hook Protocol Tests (No Claude Code, No API Key)

**Scope**: Run each hook script as a subprocess, send JSON on stdin, assert exit code and stdout.

```typescript
// src/test-utils/hook-runner.ts

export async function runHookScript(
  scriptPath: string,
  input: unknown,
  projectDir: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = spawn('node', [scriptPath], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stdin.write(JSON.stringify(input))
  proc.stdin.end()

  const stdout = await readStream(proc.stdout)
  const stderr = await readStream(proc.stderr)
  const exitCode = await new Promise<number>(resolve => proc.on('close', resolve))

  return { exitCode, stdout, stderr }
}
```

Test cases for each hook:

**`pre-tool-use.mjs`**:
```typescript
// Normal write — exit 0
runHookScript('hooks/pre-tool-use.mjs', {
  tool_name: 'Write', agent_name: 'loom',
  tool_input: { file_path: 'src/foo.ts' }, session_id: 'test'
}, projectDir) → { exitCode: 0 }

// Pattern writing .ts file — exit 2, deny
runHookScript('hooks/pre-tool-use.mjs', {
  tool_name: 'Write', agent_name: 'pattern',
  tool_input: { file_path: 'src/foo.ts' }, session_id: 'test'
}, projectDir) → { exitCode: 2, stdout: '{"permissionDecision":"deny",...}' }

// Pattern writing .md in .weave/plans/ — exit 0 (allowed)
runHookScript('hooks/pre-tool-use.mjs', {
  tool_name: 'Write', agent_name: 'pattern',
  tool_input: { file_path: '.weave/plans/my-plan.md' }, session_id: 'test'
}, projectDir) → { exitCode: 0 }
```

**`on-stop.mjs`**:
```typescript
// Non-tapestry agent — exit 0 (guard fires)
runHookScript('hooks/on-stop.mjs', {
  agent_name: 'loom', session_id: 'test'
}, projectDir) → { exitCode: 0 }

// Tapestry with active plan, remaining tasks — exit 2
// (requires projectDir to have .weave/state.json with in-progress plan)
runHookScript('hooks/on-stop.mjs', {
  agent_name: 'tapestry', session_id: 'test'
}, activePlanProjectDir) → { exitCode: 2, stdout: '{"decision":"block","reason":"..."}' }

// Tapestry with completed plan — exit 0
runHookScript('hooks/on-stop.mjs', {
  agent_name: 'tapestry', session_id: 'test'
}, completedPlanProjectDir) → { exitCode: 0 }
```

**`post-compact.mjs`**:
```typescript
// No active plan — exit 0, no stdout
runHookScript('hooks/post-compact.mjs', {
  session_id: 'test'
}, emptyProjectDir) → { exitCode: 0, stdout: '' }

// Active plan — exit 0, stdout has additionalContext with plan info
runHookScript('hooks/post-compact.mjs', {
  session_id: 'test'
}, activePlanProjectDir) → {
  exitCode: 0,
  stdout: '{"additionalContext":"...plan name...next task..."}'
}
```

**All scripts**: Malformed JSON on stdin → exit 1 (graceful), not crash.

### 6.4 Layer 3: CI Validation (No Claude Code, No API Key)

CI jobs that run on every PR:

```yaml
# .github/workflows/test.yml additions

- name: Run unit tests
  run: bun test

- name: Build all targets
  run: bun run build

- name: Validate CLI binary has no OpenCode deps
  run: |
    node -e "
      const fs = require('fs')
      const content = fs.readFileSync('dist/cli.js', 'utf-8')
      if (content.includes('@opencode-ai')) {
        console.error('FAIL: dist/cli.js contains @opencode-ai references')
        process.exit(1)
      }
      console.log('PASS: dist/cli.js has no @opencode-ai references')
    "

- name: Run weave init and validate plugin structure
  run: |
    node dist/cli.js init --cli claude-code --output /tmp/test-plugin
    node --input-type=module -e "
      const { validatePluginDir } = await import('./dist/test-utils/plugin-validator.js')
      const result = await validatePluginDir('/tmp/test-plugin')
      if (!result.valid) { console.error(result.errors); process.exit(1) }
      console.log('PASS: Plugin structure valid')
    "
    # Note: require() cannot be used here — the package has "type": "module" which
    # makes require() throw ERR_REQUIRE_ESM. Use dynamic import() instead.
    # Alternatively, move this validation into a proper test file run via bun test.
```

### 6.5 Layer 4: Smoke Tests (Optional, Requires Claude Code + API Key)

Gated behind `RUN_SMOKE_TESTS=true`. See multi-cli-support.md TODO #28 for full spec.

Minimal smoke test:
```bash
# Generate plugin, launch Claude Code with it, assert session-start hook fired
weave init --cli claude-code --output /tmp/smoke-plugin
claude -p "respond with only: OK" \
  --output-format json \
  --max-turns 1 \
  --plugin-dir /tmp/smoke-plugin
# Assert: on-session-start.mjs wrote a breadcrumb to /tmp/smoke-plugin/smoke-test.log
```

### 6.6 Test Fixtures

Create canonical fixture files for hook testing:

```
src/test-utils/fixtures/
├── hook-payloads/
│   ├── pre-tool-use-write-ts.json          ← { tool_name: "Write", agent_name: "loom", ... }
│   ├── pre-tool-use-pattern-write-md.json  ← Pattern writing .md in .weave/plans/
│   ├── pre-tool-use-pattern-write-ts.json  ← Pattern writing .ts (should block)
│   ├── on-stop-tapestry.json               ← { agent_name: "tapestry", session_id: "..." }
│   ├── on-stop-loom.json                   ← { agent_name: "loom", ... }
│   ├── post-compact.json                   ← { session_id: "..." }
│   └── user-prompt-submit.json             ← { prompt: "/start-work my-plan.md", ... }
└── project-states/
    ├── empty/                              ← No weave.json, no state.json
    │   └── .weave/.gitkeep
    ├── active-plan/                        ← In-progress plan with remaining tasks
    │   ├── weave.json
    │   └── .weave/state.json
    └── completed-plan/                     ← All tasks done
        ├── weave.json
        └── .weave/state.json
```

---

## Section 7: Migration Path (Incremental Shipping)

### Phase 0 (MVP): Agents + CLAUDE.md Only (No Hooks)

**What**: Generate only agent `.md` files, `settings.json`, `CLAUDE.md`, and `plugin.json`. No hooks, no skills, no runtime bundle.

**Value delivered**: Users can use all 8 Weave agents as Claude Code subagents. Loom dispatches to Pattern/Thread/etc. via Task tool. No write guards, no continuation — but the core multi-agent orchestration works.

**Ship criteria**:
- [ ] `weave init --cli claude-code` generates valid agent .md files
- [ ] All 8 agents have correct frontmatter (name, description, model, maxTurns, tools/disallowedTools)
- [ ] System prompts are complete and match current OpenCode prompts
- [ ] `settings.json` sets Loom as default agent
- [ ] `CLAUDE.md` describes agents and usage
- [ ] Plugin installs without errors

**User experience**: "Not quite as powerful as OpenCode — no auto-continuation — but 8 agents work great."

**Timeline**: Can ship before any WeaveCore refactoring.

### Phase 1: Pattern-MD-Only Write Guard

**What**: Add `weave-runtime.mjs` build target. Add `pre-tool-use.mjs`. Add `hooks/hooks.json` with `PreToolUse` only.

**Value delivered**: Pattern agent can't write non-.md files outside `.weave/plans/`. This is the most critical safety behavior for protecting plan integrity. Note: the existing-file read-before-write guard (`write-existing-file-guard.ts`) is **not** included in Phase 1 — it is incompatible with subprocess hook invocation (see Section 4.5). Claude Code users receive pattern-md-only protection only.

**Ship criteria**:
- [ ] `weave-runtime.mjs` is built and shipped in `dist/`
- [ ] `pre-tool-use.mjs` correctly implements `checkPatternWrite()` (pattern-md-only guard)
- [ ] `pre-tool-use.mjs` correctly blocks Pattern writing non-.md files
- [ ] `pre-tool-use.mjs` correctly allows Pattern writing `.md` in `.weave/plans/`
- [ ] Hook tests pass for all pre-tool-use cases (including malformed input)
- [ ] `hooks.json` has only `PreToolUse` registration

### Phase 2: Continuation (Tapestry Auto-Progress)

**What**: Add `on-stop.mjs`. Add `Stop` and `SubagentStop` registrations to `hooks.json`.

**Value delivered**: Tapestry auto-continues plan execution after each task. This is the core "autonomous execution" feature that makes Weave valuable for plan execution.

**Ship criteria**:
- [ ] `on-stop.mjs` uses `core.isContinuationAgent()` (not hardcoded "tapestry")
- [ ] Continuation fires for Tapestry as primary AND as subagent
- [ ] All 7 continuation safety checks work (completion, stale, pause, interrupt, context limit)
- [ ] `on-stop.mjs` exits 0 for all non-tapestry agents
- [ ] Hook tests cover active plan → continue, completed plan → stop, paused → stop, stale → stop

### Phase 3: Compaction Recovery

**What**: Add `pre-compact.mjs` and `post-compact.mjs`. Add `PreCompact`/`PostCompact` to `hooks.json`.

**Value delivered**: Tapestry recovers context after compaction without forgetting the plan. Better than OpenCode's delayed recovery.

**Ship criteria**:
- [ ] `pre-compact.mjs` writes `.weave/compaction-snapshot.json`
- [ ] `post-compact.mjs` outputs `additionalContext` with plan name, progress, next task
- [ ] Compaction round-trip test passes (pre → snapshot → post → correct context)
- [ ] No-op when no active plan (exits 0, no stdout)
- [ ] `handlePreCompact`/`handlePostCompact` implemented in runtime shim

### Phase 4: Session Start + User Prompt Hooks

**What**: Add `on-session-start.mjs` and `user-prompt-submit.mjs`. Add `SessionStart` and `UserPromptSubmit` to `hooks.json`.

**Value delivered**: Analytics session initialization. `/start-work` detection in natural language (not just skill invocation). Keyword detection for auto-pause.

**Ship criteria**:
- [ ] `on-session-start.mjs` initializes analytics session
- [ ] `user-prompt-submit.mjs` detects `/start-work` and injects work context
- [ ] `user-prompt-submit.mjs` handles keyword detection (pause keywords)
- [ ] Hook tests cover start-work detection and plain message pass-through

### Phase 5: Skills + Post-Tool Analytics

**What**: Add `skills/` directory with SKILL.md files. Add `post-tool-use.mjs` for analytics.

**Value delivered**: `/weave:start-work`, `/weave:run-workflow`, `/weave:metrics` available as plugin skills. Tool-level analytics tracking.

**Ship criteria**:
- [ ] All 3 skills have valid frontmatter + non-empty bodies derived from command templates
- [ ] `post-tool-use.mjs` records tool usage to analytics
- [ ] Skills are namespaced correctly as `/weave:start-work` etc.

---

## TODOs

### Config File Paths (Prerequisite — Do Before CLI Work)

- [ ] **CFG-1. Update `src/config/loader.ts` to support canonical `weave.json` path**
  - Support config lookup in the following priority order (highest to lowest):
    1. `<project-root>/weave.json` — new canonical CLI-agnostic name
    2. `<project-root>/.opencode/weave-opencode.json` — backward compat for existing OpenCode users
    3. `~/.config/weave/weave.json` — new user-level config path
    4. `~/.config/opencode/weave-opencode.json` — backward compat user-level path
  - Log a deprecation notice to stderr when the old `.opencode/weave-opencode.json` paths are used: `[weave] Config path '.opencode/weave-opencode.json' is deprecated — rename to 'weave.json'`
  - **Files**: `src/config/loader.ts`
  - **Acceptance**: `weave.json` at project root is loaded when present; `.opencode/weave-opencode.json` is loaded with deprecation warning when `weave.json` is absent; priority order is respected when multiple files exist

### Phase 0 Prerequisites

- [ ] **P0-1. Verify `import type` erasure**: Build a minimal test that imports `src/agents/builtin-agents.ts` via a Bun bundle with `external: []` and confirm the output contains no `@opencode-ai/sdk` references. This validates the zero-touch approach for the `AgentConfig` type boundary.
  - **Files**: `script/verify-cli-bundle.ts` (test script, not shipped)
  - **Acceptance**: Bundle output has no `@opencode-ai/sdk` strings; `bun build --entrypoint src/agents/builtin-agents.ts --external none --outfile /tmp/test.js` and grep for `opencode-ai` finds nothing.

- [ ] **P0-2. Audit CLI import graph**: Map all imports reachable from `src/agents/builtin-agents.ts`, `src/hooks/work-continuation.ts`, `src/hooks/write-existing-file-guard.ts`, `src/config/loader.ts`. Identify any that import from `src/plugin/` or `src/index.ts` (which import OpenCode types at runtime). Fix any such imports before building the CLI path.
  - **Files**: Read-only audit; fix if needed in the importing files
  - **Acceptance**: No file in the CLI import graph has a runtime (non-type) import of `@opencode-ai/plugin` or `@opencode-ai/sdk`.

### Package.json & Build System

- [ ] **PKG-1. Add `bin` entry to package.json**
  - Add `"bin": { "weave": "./dist/cli.js" }` to `package.json`
  - Add `"./cli": { "import": "./dist/cli.js" }` to `exports`
  - **Acceptance**: `npm install -g @opencode_weave/weave && weave --version` works

- [ ] **PKG-2. Add CLI build target to `script/build.ts`**
  - Second `Bun.build()` call targeting `src/cli/index.ts` → `dist/cli.js`
  - `external: []` (fully self-contained)
  - `banner: '#!/usr/bin/env node'` (shebang)
  - `define: { __VERSION__: JSON.stringify(packageVersion) }`
  - **Acceptance**: `dist/cli.js` is executable, runs with `node dist/cli.js --version`

- [ ] **PKG-3. Add runtime bundle build target to `script/build.ts`**
  - Third `Bun.build()` call targeting `src/runtime/index.ts` → `dist/weave-runtime.js`
  - `external: []` (fully self-contained)
  - Includes all of: config loading, agent building, work continuation, write guards, compaction handlers
  - **Acceptance**: `dist/weave-runtime.js` exports `createWeaveCore`; `node -e "import('./dist/weave-runtime.js').then(m => console.log(typeof m.createWeaveCore))"` prints `function`

- [ ] **PKG-4. Add `chmod +x dist/cli.js` to build script** (Linux/Mac)
  - Post-build step to make CLI binary executable
  - **Acceptance**: `ls -la dist/cli.js` shows executable bit set on Unix

### Runtime Shim

- [ ] **RT-1. Create `src/runtime/index.ts`** — the `createWeaveCore()` export for hook scripts
  - Exports: `createWeaveCore(directory: string): Promise<WeaveCoreRuntime>`
  - Interface includes: `isContinuationAgent`, `checkToolBefore`, `handleWorkContinuation`, `handlePreCompact`, `handlePostCompact`
  - Implemented over existing: `src/hooks/work-continuation.ts`, `src/hooks/pattern-md-only.ts`, `src/config/loader.ts`
  - Note: `write-existing-file-guard.ts` is intentionally NOT used (incompatible with subprocess invocation — see Section 4.5)
  - **Files**: `src/runtime/index.ts`, `src/runtime/types.ts`
  - **Acceptance**: All 5 methods callable; `createWeaveCore('/tmp/empty-project')` returns without error

- [ ] **RT-2. Implement `isContinuationAgent`** in runtime shim
  - Returns `true` only for `"tapestry"` (hardcoded in shim, will be driven by config in Phase 3 full WeaveCore)
  - **Acceptance**: `core.isContinuationAgent("tapestry") === true`, `core.isContinuationAgent("loom") === false`

- [ ] **RT-3. Implement `checkToolBefore`** in runtime shim
  - Calls `checkPatternWrite()` from `src/hooks/pattern-md-only.ts` **only**
  - Does NOT call `checkWriteAllowed()` from `src/hooks/write-existing-file-guard.ts` — that guard requires per-session in-memory state incompatible with subprocess invocation (see Section 4.5)
  - Returns `{ allowed: boolean, reason?: string }`
  - **Acceptance**: Pattern writing `.ts` → `{ allowed: false, reason: "..." }`; Pattern writing `.weave/plans/x.md` → `{ allowed: true }`; Loom writing any file → `{ allowed: true }`

- [ ] **RT-4. Implement `handleWorkContinuation`** in runtime shim
  - Calls existing logic from `src/hooks/work-continuation.ts`
  - Reads `.weave/state.json` from `directory`
  - Returns `{ shouldContinue: boolean, continuationPrompt?: string }`
  - **Acceptance**: Active plan with remaining tasks → `{ shouldContinue: true, continuationPrompt: "..." }`; completed plan → `{ shouldContinue: false }`

- [ ] **RT-5. Implement `handlePreCompact`** in runtime shim
  - Reads current plan state from `.weave/state.json`
  - Writes snapshot to `.weave/compaction-snapshot.json`
  - **Acceptance**: Snapshot file written with `{ planName, currentTaskIndex, totalTasks, timestamp }`

- [ ] **RT-6. Implement `handlePostCompact`** in runtime shim
  - Reads snapshot from `.weave/compaction-snapshot.json`
  - Reads current plan file to get task names
  - Returns `{ reOrientationContext?: string }` with plan name, progress, next task
  - **Acceptance**: Active plan → returns context string containing plan name and next task name; no plan → returns `{}`

### CLI Entry Point

- [ ] **CLI-1. Create `src/cli/index.ts`** — main CLI entry point
  - Parses args using `node:util` `parseArgs`
  - Routes to `init` command
  - Prints version, handles unknown commands
  - **Acceptance**: `node dist/cli.js --version` prints version; `node dist/cli.js init --help` prints usage

- [ ] **CLI-2. Create `src/cli/commands/init.ts`** — init command implementation
  - Accepts `{ cli, output, force, dryRun }` options
  - Routes to `generateClaudeCodePlugin()` for `--cli claude-code`
  - Prints success message with install instructions
  - Prints feature degradation report
  - **Acceptance**: `weave init --cli claude-code` generates valid plugin dir and prints install instructions

### Plugin Generator

- [ ] **GEN-1. Create `src/adapters/claude-code/plugin-generator.ts`** — orchestrates generation
  - Accepts `{ outputDir, config, agents, commands, force, dryRun }`
  - Creates directory structure
  - Calls each file generator
  - Copies `weave-runtime.mjs` from `dist/`
  - **Acceptance**: Generates complete plugin directory passing `validatePluginDir()`

- [ ] **GEN-2. Create `src/adapters/claude-code/agent-mapper.ts`** — agent → markdown
  - `mapAgent(name: string, agent: AgentConfig, metadata: AgentPromptMetadata): string`
  - Generates YAML frontmatter + prompt body
  - Applies tool config table (Pattern allowlist, read-only agents denylist)
  - **Must NOT** include `hooks`, `mcpServers`, `permissionMode` fields
  - **Acceptance**: All 8 agents pass `validateSubagentMd()`

- [ ] **GEN-3. Create `src/adapters/claude-code/skill-mapper.ts`** — command → SKILL.md
  - `mapCommand(cmd: BuiltinCommand): string | null`
  - Exposes: `start-work`, `run-workflow`, `metrics` (not `token-report`)
  - Derives skill body from `cmd.template` (not hardcoded)
  - **Acceptance**: `/weave:start-work` skill body contains instruction derived from `START_WORK_TEMPLATE`

- [ ] **GEN-4. Create `src/adapters/claude-code/hook-generator.ts`** — hooks.json + scripts
  - `generateHooksJson(): string` — static JSON with 8 hook registrations
  - `generateHookScript(name: HookScriptName): string` — static template for each script
  - All scripts import from `./weave-runtime.mjs`
  - All scripts have try/catch error handling (exit 1 on error, not crash)
  - **Acceptance**: `hooks.json` passes `validateHooksJson()`; each script is valid Node.js ESM

- [ ] **GEN-5. Create `src/adapters/claude-code/static-files.ts`** — plugin.json, settings.json, CLAUDE.md
  - `generatePluginJson(version: string): string`
  - `generateSettingsJson(): string` → `{ "agent": "loom" }`
  - `generateClaudeMd(agents: string[]): string` — comprehensive agent guide
  - **Acceptance**: `plugin.json` has all required fields; `settings.json` is `{ agent: "loom" }`

### Test Infrastructure

- [ ] **TEST-1. Create `src/test-utils/plugin-validator.ts`**
  - `validatePluginDir(dir)`, `validateSubagentMd(path)`, `validateHooksJson(path)`, `validateSkillMd(path)`
  - **Acceptance**: Correctly validates the generated plugin dir; rejects files with forbidden frontmatter fields

- [ ] **TEST-2. Create `src/test-utils/hook-runner.ts`**
  - `runHookScript(scriptPath, input, projectDir)` — spawns node subprocess, captures exit code + stdout + stderr
  - **Acceptance**: Can run a trivial echo script; captures exit code 0/2 correctly

- [ ] **TEST-3. Create test fixture directories**
  - `src/test-utils/fixtures/project-states/empty/`
  - `src/test-utils/fixtures/project-states/active-plan/` (with realistic `state.json`)
  - `src/test-utils/fixtures/project-states/completed-plan/`
  - `src/test-utils/fixtures/hook-payloads/*.json`
  - **Acceptance**: Fixtures are valid JSON; `active-plan/state.json` represents a realistic in-progress plan

- [ ] **TEST-4. Write unit tests for each generator** (`agent-mapper.test.ts`, `skill-mapper.test.ts`, etc.)
  - Cover: all 8 agents, forbidden field absence, correct tool configs, skill body derivation
  - **Acceptance**: All tests pass with `bun test`

- [ ] **TEST-5. Write plugin structure integration test** (`plugin-structure.test.ts`)
  - Run full `generateConfig()` against empty and active-plan project dirs
  - Validate complete plugin dir structure
  - **Acceptance**: `validatePluginDir()` returns `{ valid: true }` for generated output

- [ ] **TEST-6. Write hook protocol tests** (`hooks-integration.test.ts`)
  - Each hook script tested with at least 3 inputs: allow case, block case, malformed input
  - Uses `runHookScript()` from test-utils
  - **Acceptance**: All assertions pass; no test spawns Claude Code

- [ ] **TEST-7. Write compaction round-trip test** (`compaction.test.ts`)
  - Run `pre-compact.mjs` against `active-plan` fixture
  - Assert snapshot written to `.weave/compaction-snapshot.json`
  - Run `post-compact.mjs` against same directory
  - Assert `additionalContext` in stdout contains plan name and next task name
  - **Acceptance**: Round-trip test passes; no Claude Code needed

- [ ] **TEST-8. Add CI check for CLI bundle cleanliness**
  - Assert `dist/cli.js` contains no `@opencode-ai/sdk` or `@opencode-ai/plugin` strings
  - **Acceptance**: CI step passes; fails correctly if OpenCode dep leaks into CLI bundle

---

## Verification Criteria

### Packaging
- [ ] `npx @opencode_weave/weave --version` works without any project setup
- [ ] `npx @opencode_weave/weave init --cli claude-code` generates a complete plugin directory
- [ ] `dist/cli.js` contains no `@opencode-ai/sdk` or `@opencode-ai/plugin` runtime code
- [ ] `dist/index.js` (OpenCode plugin) is unchanged from pre-CLI-addition state
- [ ] `weave` is available as a global command after `npm install -g @opencode_weave/weave`
- [ ] `package.json` `files: ["dist/"]` includes all three new bundles (cli.js, weave-runtime.js)

### Generated Plugin
- [ ] `validatePluginDir()` passes for the generated directory
- [ ] All 8 agent `.md` files have valid YAML frontmatter, non-empty prompt bodies
- [ ] No agent `.md` file contains `hooks:`, `mcpServers:`, or `permissionMode:` in frontmatter
- [ ] `pattern.md` frontmatter has `tools: [Read, Glob, Grep, Write]`
- [ ] `thread.md`, `spindle.md`, `weft.md`, `warp.md` frontmatter has `disallowedTools: [Write, Edit, MultiEdit, Bash]`
- [ ] `hooks/hooks.json` has exactly 8 hook registrations including `SubagentStop` with `matcher: "tapestry"`
- [ ] All hook commands reference `${CLAUDE_PLUGIN_ROOT}/hooks/*.mjs`
- [ ] `settings.json` is exactly `{ "agent": "loom" }`
- [ ] `.claude-plugin/plugin.json` has `name: "weave"`, `version`, `description`
- [ ] `CLAUDE.md` mentions all 8 agent names

### Hook Protocol
- [ ] `pre-tool-use.mjs` exits 0 for Loom writing any file
- [ ] `pre-tool-use.mjs` exits 2 + `{ permissionDecision: "deny" }` for Pattern writing `.ts`
- [ ] `pre-tool-use.mjs` exits 0 for Pattern writing `.weave/plans/*.md`
- [ ] `on-stop.mjs` exits 0 for non-tapestry agents (loom, pattern, thread, etc.)
- [ ] `on-stop.mjs` exits 2 + `{ decision: "block", reason: "<continuation prompt>" }` for tapestry with active plan
- [ ] `on-stop.mjs` exits 0 for tapestry when plan is complete
- [ ] `on-stop.mjs` exits 0 for tapestry when plan is paused
- [ ] `pre-compact.mjs` exits 0 always; writes snapshot when plan active
- [ ] `post-compact.mjs` exits 0 always; stdout contains `additionalContext` when plan active
- [ ] All hook scripts exit 1 (not crash) on malformed JSON stdin

### Onboarding
- [ ] New user can go from zero to working Claude Code plugin in < 3 minutes with `npx`
- [ ] Existing OpenCode user's `weave.json` config is honored (disabled agents, overrides)
- [ ] Generated plugin dir is safe to commit (deterministic, no secrets)
- [ ] Success message includes install instructions and re-run cadence explanation

---

## Risks

### R1: Claude Code Plugin API Changes
**Probability**: Medium. **Impact**: High.
The Claude Code plugin spec (hooks.json format, frontmatter fields, skill invocation) is relatively new and may change.
**Mitigation**: Pin the hook format to what's verified by testing. Add plugin spec version to `plugin.json`. The `validatePluginDir()` test suite will catch format regressions on Weave's side. The `--dry-run` flag lets users preview before committing.

### R2: `${CLAUDE_PLUGIN_ROOT}` Not Available in All Hook Contexts
**Probability**: Low. **Impact**: High.
If `CLAUDE_PLUGIN_ROOT` isn't set in hook subprocess environment, all hook commands fail.
**Mitigation**: Add a fallback in each hook script: `const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? new URL('..', import.meta.url).pathname`. The `import.meta.url` of the script itself gives us the hooks/ directory, and `..` gives the plugin root.

### R3: Node.js Version Compatibility
**Probability**: Low. **Impact**: Medium.
Hook scripts use ESM (`import`), top-level `await`, and `for await` loops. These require Node.js 14.8+.
**Mitigation**: Add a Node.js version check at the top of each hook script. Most environments with Claude Code installed will have Node.js 18+. Add to `CLAUDE.md`: "Requires Node.js 14.8+ for hook scripts."

### R4: WeaveCore Not Yet Extracted (Phase 0 of multi-cli-support.md)
**Probability**: High (it hasn't been done yet). **Impact**: Medium.
The `createWeaveCore()` runtime shim works around this, but it means the CLI and hook runtime use a partial implementation that doesn't benefit from the full WeaveCore refactoring.
**Mitigation**: The shim is explicitly designed to be replaced by the real WeaveCore when Phase 1 of multi-cli-support.md is done. It's a valid stepping stone. Ship the MVP (Phase 0 of this plan — agents only) before the shim is complete, then add hooks incrementally.

### R5: Bundle Size of `weave-runtime.mjs`
**Probability**: Medium. **Impact**: Low.
If `weave-runtime.mjs` is large (>2MB), it will slow hook startup time.
**Mitigation**: The runtime bundle should only include the hook-relevant logic (config loading, agent building, work state, write guards, continuation) — NOT the full OpenCode plugin logic. Target <500KB. Monitor with `ls -la dist/weave-runtime.js` in CI and fail if >1MB.

### R6: Duplicate Agent Prompts Between OpenCode and Claude Code
**Probability**: Low (prevented by design). **Impact**: High.
If the agent `.md` files diverge from the OpenCode prompts, the two CLIs get different agent behavior.
**Mitigation**: The generator calls `createBuiltinAgents()` with the same options as OpenCode. The `agent.prompt` field is the single source of truth. The `.md` files are always generated from the canonical prompt — never maintained separately. This is enforced by the generation code, not by documentation.

### R7: `weave.json` Not Found at Hook Runtime
**Probability**: Low. **Impact**: Medium.
Hook scripts call `createWeaveCore(process.cwd())`. If `process.cwd()` is not the project root when Claude Code invokes hooks, `weave.json` won't be found.
**Mitigation**: Claude Code hook scripts receive the project root as an environment variable or in the JSON payload. Add fallback logic: if `weave.json` not found at `cwd`, walk up the directory tree looking for it (same strategy as most config file conventions). Add a defensive check and log a warning to stderr if not found (don't crash — fall through to defaults).

---

## Implementation Notes (Weft Review Clarifications)

### N1: `CLAUDE_PLUGIN_ROOT` Environment Variable

`CLAUDE_PLUGIN_ROOT` is a real environment variable documented in Claude Code's plugin docs. It is injected by Claude Code into the environment of every hook subprocess and resolves to the absolute path of the installed plugin directory. The plan's usage (e.g., `"node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs\""` in `hooks.json`) is correct and intentional. No workaround is needed.

### N2: Bun `banner` Option Scope

The plan calls `Bun.build()` separately for each build target: plugin bundle (Build 1), CLI bundle (Build 2), and runtime bundle (Build 3). The `banner: '#!/usr/bin/env node'` option appears only in Build 2 (the CLI bundle). This is safe and correct — each `Bun.build()` invocation is independent and the banner option applies only to the build it's passed to. The plugin bundle and runtime bundle are not affected.

### N3: `import.meta.url` Through npm Bin Symlinks

When users run `weave` as a global command, Node.js resolves the `bin` symlink but `import.meta.url` may point to the symlink path rather than the real file path. This causes path resolution failures when the CLI tries to locate `dist/weave-runtime.js` relative to its own location.

**Fix**: In `src/cli/commands/init.ts` (wherever the runtime bundle path is computed), use `fs.realpathSync` to resolve through symlinks before computing the relative path:

```typescript
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Resolve symlinks so relative paths work when invoked via npm bin symlink
const __filename = realpathSync(fileURLToPath(import.meta.url))
const __dirname = dirname(__filename)

// Now this correctly resolves to dist/weave-runtime.js regardless of symlinks
const runtimeBundlePath = resolve(__dirname, '..', 'weave-runtime.js')
```
