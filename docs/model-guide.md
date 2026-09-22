# Model Selection Guide

> [!IMPORTANT]
> **This page documents the legacy `@opencode_weave/weave` plugin, which is no longer maintained.** Weave has moved to [weave-io/weave](https://github.com/weave-io/weave) and is documented at [tryweave.io/docs](https://tryweave.io/docs/). To move over and keep your agents and prompts, follow [Upgrading from legacy Weave](https://tryweave.io/docs/upgrade-from-legacy/).

Weave assigns each agent a default model, but you can override them. This guide gives you practical advice on picking the right model when the defaults aren't available.

## The Three Tiers

Weave's agents fall into three tiers based on how much reasoning power they need:

| Tier | Agents | What They Do | What They Need |
|------|--------|-------------|----------------|
| **Top** | Loom, Pattern, Warp | Orchestration, planning, security auditing | The strongest reasoning you can afford. These agents make decisions that cascade through the entire workflow — bad judgment here means bad results everywhere. |
| **Mid** | Tapestry, Weft, Shuttle | Code execution, reviewing, domain tasks | Good coding ability and comprehension. They follow structured plans and analyze code — they don't need to be brilliant, but they can't be sloppy. |
| **Economy** | Thread, Spindle | Codebase search, web research | Speed over depth. These agents read files and search — they don't make architectural decisions. Fast, cheap models work great here. |

## Practical Recommendations

### Anthropic

**Opus-class** models (Opus 4, Opus 4.5, etc.) → use for **Loom, Pattern, Warp**

Opus models are the best fit for top-tier agents. They have the deepest reasoning, handle complex multi-step delegation well, and catch subtle issues in security auditing. If you can only afford Opus for one agent, prioritize Loom — it's the orchestrator and bad decisions there affect everything downstream.

**Sonnet-class** models (Sonnet 4, Sonnet 4.5, etc.) → use for **Tapestry, Weft, Shuttle**

Sonnet is the sweet spot for execution and review. Fast enough to not slow you down, smart enough to write good code and catch real issues in review. Sonnet also works as a *fallback* for top-tier agents if Opus is too expensive — you'll notice some quality degradation in complex planning, but it's workable.

**Haiku-class** models (Haiku 4, Haiku 4.5, etc.) → use for **Thread, Spindle**

Haiku is purpose-built for the economy tier. Thread and Spindle do high-volume, low-complexity work — reading files, searching code, fetching docs. Haiku handles this perfectly and keeps costs low. Don't use Haiku for mid-tier or top-tier agents — it will noticeably struggle with complex code generation and nuanced reasoning.

### OpenAI

**GPT-4o / GPT-5** → use for **Loom, Pattern, Warp**

These are OpenAI's strongest general-purpose models. Good reasoning, good function calling, good at following complex system prompts. Either works well for top-tier agents.

**o3 / o4-mini** (reasoning models) → **use with caution**

The o-series models are powerful reasoners but behave differently — they use internal chain-of-thought, can be slower, and don't always stream well. They *can* work for Pattern and Warp (where deep thinking helps), but test before committing. They're not ideal for Loom, which needs to be responsive and make quick delegation decisions.

**GPT-4o-mini / GPT-4.1-mini** → use for **Tapestry, Weft, Shuttle, Thread, Spindle**

The mini models are fast and capable enough for execution work. They handle code generation, review, and search well. For economy agents (Thread, Spindle), they're slightly overpowered but work fine — there isn't a cheaper OpenAI option with reliable tool calling.

**GPT-4.1** → a solid **mid-tier** option for **Tapestry, Weft, Shuttle**

GPT-4.1 has strong coding ability and a 1M token context window. It's a good fit for Tapestry when working on large codebases where you need the model to hold a lot of context. It's not a reasoning model, so keep it in the mid tier.

## What Actually Matters Per Agent

### Loom (Orchestrator) — needs the best you've got

Loom decides what to delegate, to whom, and in what order. It reads your request, breaks it into tasks, picks the right specialist, and writes their instructions. If Loom misunderstands your intent or makes a poor delegation choice, everything downstream suffers. This is not the place to save money.

**Best**: Opus-class, GPT-5 | **Acceptable**: Sonnet-class, GPT-4o | **Avoid**: Haiku, mini models

### Pattern (Planner) — deep reasoning, architectural thinking

Pattern analyzes your codebase and produces detailed implementation plans. It needs to understand file dependencies, anticipate edge cases, and order tasks correctly. Weak models produce plans that look reasonable but fall apart during execution.

**Best**: Opus-class, GPT-5 | **Acceptable**: Sonnet-class, GPT-4o, o3 | **Avoid**: Haiku, mini models

### Warp (Security Auditor) — skeptical, deep analysis

Warp looks for security vulnerabilities and spec violations. It needs to understand OAuth flows, JWT validation, CORS policies, and subtle injection vectors. Security auditing is one of the hardest tasks for a model — cheap models miss real issues and flag false positives.

**Best**: Opus-class, o3, GPT-5 | **Acceptable**: Sonnet-class, GPT-4o | **Avoid**: Haiku, mini models

### Tapestry (Executor) — reliable code generation

Tapestry writes actual code, following plans step by step. It needs to generate correct, idiomatic code and verify its own work. It doesn't need to be creative — it needs to be reliable.

**Best**: Sonnet-class, GPT-4o | **Acceptable**: GPT-4.1, GPT-4o-mini | **Avoid**: Haiku

### Weft (Reviewer) — balanced critical analysis

Weft reviews code and plans. It needs to spot real problems without drowning you in nitpicks. A model that's too weak will miss issues; a model that's too strong is wasted here (though not harmful).

**Best**: Sonnet-class, GPT-4o | **Acceptable**: GPT-4.1, GPT-4o-mini | **Avoid**: Haiku

### Thread & Spindle (Explorers) — fast and cheap

These agents search codebases and fetch docs. They don't make decisions — they find information and report back. Speed matters more than depth. This is where you save money.

**Best**: Haiku-class, GPT-4o-mini | **Acceptable**: Any mini/flash model | **Overkill**: Opus, GPT-5

## Example Configurations

### Anthropic-Only

```jsonc
{
  "agents": {
    "loom":     { "model": "anthropic/claude-opus-4" },
    "pattern":  { "model": "anthropic/claude-opus-4" },
    "warp":     { "model": "anthropic/claude-opus-4" },
    "tapestry": { "model": "anthropic/claude-sonnet-4" },
    "weft":     { "model": "anthropic/claude-sonnet-4" },
    "shuttle":  { "model": "anthropic/claude-sonnet-4" },
    "thread":   { "model": "anthropic/claude-haiku-4" },
    "spindle":  { "model": "anthropic/claude-haiku-4" }
  }
}
```

### OpenAI-Only

```jsonc
{
  "agents": {
    "loom":     { "model": "openai/gpt-5" },
    "pattern":  { "model": "openai/gpt-5" },
    "warp":     { "model": "openai/gpt-5" },
    "tapestry": { "model": "openai/gpt-4o" },
    "weft":     { "model": "openai/gpt-4o" },
    "shuttle":  { "model": "openai/gpt-4o" },
    "thread":   { "model": "openai/gpt-4o-mini" },
    "spindle":  { "model": "openai/gpt-4o-mini" }
  }
}
```

### Budget-Conscious (Sonnet Everywhere)

If Opus is too expensive, Sonnet-class models work across all tiers. You'll notice weaker planning and security auditing, but it's a viable setup:

```jsonc
{
  "agents": {
    "loom":     { "model": "anthropic/claude-sonnet-4" },
    "pattern":  { "model": "anthropic/claude-sonnet-4" },
    "warp":     { "model": "anthropic/claude-sonnet-4" },
    "tapestry": { "model": "anthropic/claude-sonnet-4" },
    "weft":     { "model": "anthropic/claude-sonnet-4" },
    "shuttle":  { "model": "anthropic/claude-sonnet-4" },
    "thread":   { "model": "anthropic/claude-haiku-4" },
    "spindle":  { "model": "anthropic/claude-haiku-4" }
  }
}
```

## How Model Resolution Works

When Weave resolves which model an agent uses, it checks in this order:

1. **Config override** (`agents.<name>.model`) — always wins
2. **UI-selected model** — only applies to Loom, Tapestry, and Shuttle
3. **Category model** — if the agent has a category with a model configured
4. **Built-in fallback chain** — tries each default against your available models
5. **System default** — the global fallback
6. **Hardcoded fallback** — `github-copilot/claude-opus-4.8`

Model names must include the provider prefix: `anthropic/claude-sonnet-4`, not just `claude-sonnet-4`.

## Downgrade Impact

| Agent | Risk of Using a Weaker Model |
|-------|----|
| **Loom** | ⚠️ High — poor delegation decisions cascade through everything |
| **Pattern** | ⚠️ High — plans miss edge cases, bad task ordering |
| **Warp** | ⚠️ High — missed security vulnerabilities |
| **Tapestry** | 🟡 Medium — more code errors, less idiomatic output |
| **Weft** | 🟡 Medium — missed issues or false positives in review |
| **Shuttle** | 🟡 Medium — depends on task complexity |
| **Thread** | 🟢 Low — search and read; fast models work great |
| **Spindle** | 🟢 Low — web research; fast models work great |
