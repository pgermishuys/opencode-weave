# Delegation Categories Example

This example shows how to configure **Mode 2** task routing for Tapestry with two domain categories: `backend` and `frontend`.

> The schema field for file-based routing is `patterns`. This README uses “file patterns” to describe it because that is how Tapestry matches the task's `**Files**` list.

## Files

- `weave-opencode.jsonc` — example config to copy into `.opencode/weave-opencode.jsonc`

The example's `$schema` points at the current `main` branch schema so the documented `categories.*.patterns` field validates against the schema content this example relies on. If you want a pinned URL in your own repository, pin it to a Weave release that includes `patterns`.

## What the config does

- Registers `backend` and `frontend` categories
- Gives each category its own `model`
- Gives each category its own file-routing `patterns`
- Appends category-specific guidance with `prompt_append`

When categories are configured, Weave also makes `shuttle-backend` and `shuttle-frontend` available in addition to the base `shuttle` agent.

## Mode 1 vs Mode 2

### Mode 1: Uncategorized

If no categories are configured, Tapestry delegates every implementation task to the plain `shuttle` agent.

Flow:

1. Tapestry reads the next unchecked task
2. Tapestry delegates to `shuttle`
3. Shuttle implements the task
4. Tapestry verifies the result and marks progress

### Mode 2: Categorized

If categories are configured, Tapestry still coordinates execution, but it chooses the best Shuttle variant for each task.

This example uses only categories with `patterns`, so both can participate in automatic file-based routing. Categories without `patterns` are still valid, but they are explicit/manual-use only and are never auto-selected from file matches.

Routing order:

1. Check for an explicit task tag like `[category:frontend]`
2. Otherwise compare the task's `**Files**` list against category `patterns` in config declaration order
3. Delegate to the first matching `shuttle-{category}` agent
4. If nothing matches, fall back to the plain `shuttle`

Tapestry remains the coordinator in both modes. It does not implement the code directly; it delegates, verifies, and advances the plan.

## How this example routes work

### `backend`

- Model: `anthropic/claude-sonnet-4.5`
- File patterns: `src/api/**`, `src/server/**`, `src/db/**`, `**/*.go`, `**/*.cs`
- Prompt append: emphasizes API contracts, data integrity, backwards compatibility, and server-side verification

Example tasks that would usually route to `shuttle-backend`:

- `src/api/users.ts`
- `src/server/auth/session.go`
- `src/db/migrations/20260424_add_index.sql` would **not** match this exact example unless you add a SQL pattern

### `frontend`

- Model: `openai/gpt-5`
- File patterns: `src/components/**`, `src/pages/**`, `src/app/**/*.tsx`, `**/*.tsx`, `**/*.css`, `**/*.vue`
- Prompt append: emphasizes accessibility, responsive behavior, design-system consistency, and small UI diffs

Example tasks that would usually route to `shuttle-frontend`:

- `src/components/NavBar.tsx`
- `src/pages/settings.tsx`
- `src/styles/theme.css`
- `src/ui/DarkModeToggle.vue`

## Why declaration order matters

Tapestry uses the **first matching category** when multiple category patterns overlap, so put your most specific or most important categories first.

## Copy into a project

Place the example config at:

```text
.opencode/weave-opencode.jsonc
```

Then adjust:

- model names to match the providers you use
- file patterns to match your repository layout
- prompt append text to match your team conventions
