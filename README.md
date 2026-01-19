# Weave

Weave is a lean OpenCode plugin with multi-agent orchestration. It provides a cohesive framework for weaving agents, tools, and skills into structured workflows. By delegating complex tasks to specialized agents and monitoring execution state through hooks, Weave ensures reliable and efficient project development.

## Overview

- **6 specialized agents** with weaving-themed names designed for specific roles in the development lifecycle.
- **Category-based task dispatch** to route work to domain-optimized models and configurations.
- **Skill system** for injecting domain-specific expertise that modifies agent behavior via prompt orchestration.
- **Background agent management** for parallel asynchronous sub-agent execution with concurrency control.
- **Context window monitoring** to track token usage and suggest recovery strategies when limits are approached.
- **Tool permissions** enforced per-agent to ensure safety and prevent unauthorized file modifications.
- **JSONC configuration** supporting comments and trailing commas with hierarchical user and project-level merging.

## Agents

| Agent | Role | Mode | Description |
| :--- | :--- | :--- | :--- |
| **Loom** | main orchestrator | primary | The central team lead that plans tasks, coordinates work, and delegates to specialized agents. |
| **Tapestry** | execution orchestrator | primary | Manages todo-list driven execution of multi-step plans, focusing on sequential implementation without subagent spawning. |
| **Shuttle** | category worker | all | Domain-specific specialist worker with full tool access, dispatched dynamically via the category system. |
| **Pattern** | strategic planner | subagent | Analyzes requirements and produces detailed implementation plans with research and dependency mapping. |
| **Thread** | codebase explorer | subagent | Fast, read-only codebase navigation and analysis using grep, glob, and read tools. |
| **Spindle** | external researcher | subagent | Performs external documentation lookups and reference searches, providing synthesized answers with source citations. |

### Agent Modes

- `primary`: Respects the user-selected model in the OpenCode UI.
- `subagent`: Uses its own model or fallback chain, ignoring UI selection for predictable specialization.
- `all`: Available in both primary and subagent contexts.

## Installation

### Prerequisites

- OpenCode
- Bun or Node.js

### Step 1: Install

```bash
bun add weave-opencode
# or
npm install weave-opencode
```

### Step 2: Register in opencode.json

Add the plugin to your `opencode.json` file:

```json
{
  "plugin": ["weave-opencode"]
}
```

### Step 3: Restart OpenCode

The plugin loads automatically upon restart and works with zero configuration out of the box.

## Configuration

Weave searches for configuration files in the following locations, merging them in order (user config → project config → defaults):

- **Project**: `.opencode/weave-opencode.jsonc` or `.opencode/weave-opencode.json`
- **User**: `~/.config/opencode/weave-opencode.jsonc` or `~/.config/opencode/weave-opencode.json`

The configuration uses JSONC format, allowing for comments and trailing commas.

### Example Configuration

```jsonc
{
  // Override agent models and parameters
  "agents": {
    "loom": { 
      "model": "anthropic/claude-3-5-sonnet", 
      "temperature": 0.1 
    },
    "thread": { 
      "model": "openai/gpt-4o-mini" 
    }
  },
  // Category-based dispatch overrides
  "categories": {
    "visual-engineering": { 
      "model": "google/gemini-2-pro" 
    }
  },
  // Selective feature toggling
  "disabled_hooks": [],
  "disabled_agents": [],
  "disabled_tools": [],
  "disabled_skills": [],
  // Background agent concurrency limits
  "background": {
    "defaultConcurrency": 5
  }
}
```

### Configuration Fields

- `agents` — Override model, temperature, prompt_append, tools, and skills per agent.
- `categories` — Custom model and tool configurations for category-based dispatch.
- `disabled_hooks` / `disabled_agents` / `disabled_tools` / `disabled_skills` — Selective feature disabling.
- `background` — Concurrency limits and timeouts for parallel background agents.
- `tmux` — Terminal multiplexer layout settings for TUI integration.
- `skills` — Custom skill discovery paths and recursion settings.
- `experimental` — Plugin load timeouts and context window threshold adjustments.

## Features

### Hooks

Weave includes 5 built-in hooks that monitor and modify agent behavior:

- `context-window-monitor` — Warns when token usage approaches limits and suggests recovery strategies.
- `write-existing-file-guard` — Tracks file reads to prevent agents from overwriting files they haven't examined.
- `rules-injector` — Automatically injects contextual rules when agents enter directories containing AGENTS.md.
- `first-message-variant` — Applies specific prompt variants on session start for consistent behavior.
- `keyword-detector` — Detects keywords in messages to trigger behavioral changes or agent switches.

All hooks are enabled by default and can be disabled via the `disabled_hooks` configuration.

### Skills

Skills are injectable prompt expertise loaded from markdown files (SKILL.md). They modify agent behavior by prepending domain-specific instructions to the agent's system prompt.

Skills are discovered across three scopes:
- `builtin` — Provided by the Weave plugin.
- `user` — Located in the user's global configuration directory.
- `project` — Located in the current project's `.opencode/skills/` directory.

### Background Agents

Weave supports parallel asynchronous sub-agent management via the BackgroundManager. This allows Loom to spawn multiple agents simultaneously to handle independent tasks, with configurable concurrency limits to manage API rate limits.

### Tool Permissions

Tool access is controlled per-agent to ensure safety and specialized focus. For example, **Thread** and **Spindle** are strictly read-only; they are denied access to write, edit, and task management tools. These permissions can be customized globally or per-agent in the configuration.

## Development

- **Build**: `bun run build`
- **Test**: `bun test`
- **Typecheck**: `bun run typecheck`
- **Clean**: `bun run clean`

## License

MIT
