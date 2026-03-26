# Provider Configurations

Weave uses **Anthropic** as the default provider. This document shows how to configure alternative providers for different agents.

## Config File Location

Edit `~/.config/opencode/weave-opencode.jsonc` (or `.json` for JSON).

## Default: Anthropic

Weave's default configuration uses Anthropic models:

```jsonc
{
  "agents": {
    "loom":     { "model": "anthropic/claude-opus-4-5" },
    "pattern":  { "model": "anthropic/claude-opus-4-5" },
    "warp":     { "model": "anthropic/claude-opus-4-5" },
    "tapestry": { "model": "anthropic/claude-sonnet-4-5" },
    "weft":     { "model": "anthropic/claude-sonnet-4-5" },
    "shuttle":  { "model": "anthropic/claude-sonnet-4-5" },
    "thread":   { "model": "anthropic/claude-haiku-4" },
    "spindle":  { "model": "anthropic/claude-haiku-4" }
  }
}
```

## OpenAI

To use OpenAI models:

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

## Google

To use Google Gemini models:

```jsonc
{
  "agents": {
    "loom":     { "model": "google/gemini-2-5-pro" },
    "pattern":  { "model": "google/gemini-2-5-pro" },
    "warp":     { "model": "google/gemini-2-5-pro" },
    "tapestry": { "model": "google/gemini-2-5-flash" },
    "weft":     { "model": "google/gemini-2-5-flash" },
    "shuttle":  { "model": "google/gemini-2-5-flash" },
    "thread":   { "model": "google/gemini-2-5-flash" },
    "spindle":  { "model": "google/gemini-2-5-flash" }
  }
}
```

## GitHub Copilot

To use GitHub Copilot models:

```jsonc
{
  "agents": {
    "loom":     { "model": "github-copilot/claude-opus-4-6" },
    "pattern":  { "model": "github-copilot/claude-opus-4-6" },
    "warp":     { "model": "github-copilot/claude-opus-4-6" },
    "tapestry": { "model": "github-copilot/claude-sonnet-4-6" },
    "weft":     { "model": "github-copilot/claude-sonnet-4-6" },
    "shuttle":  { "model": "github-copilot/claude-sonnet-4-6" },
    "thread":   { "model": "github-copilot/claude-haiku-4-6" },
    "spindle":  { "model": "github-copilot/claude-haiku-4-6" }
  }
}
```

## Mixed Providers

You can mix models from different providers across agents:

```jsonc
{
  "agents": {
    "loom":     { "model": "anthropic/claude-opus-4-5" },
    "pattern":  { "model": "anthropic/claude-opus-4-5" },
    "warp":     { "model": "openai/gpt-5" },
    "tapestry": { "model": "openai/gpt-4o" },
    "weft":     { "model": "google/gemini-2-5-flash" },
    "shuttle":  { "model": "google/gemini-2-5-flash" },
    "thread":   { "model": "openai/gpt-4o-mini" },
    "spindle":  { "model": "openai/gpt-4o-mini" }
  }
}
```

## Provider-Specific Notes

### Anthropic
- **Recommended for**: Production use with best reasoning
- **Strengths**: Deep reasoning, tool use, long context
- **Models**: opus-4-5 (top), sonnet-4-5 (mid), haiku-4 (economy)

### OpenAI
- **Recommended for**: General purpose, fast iteration
- **Strengths**: Good reasoning, excellent tool use, large context
- **Models**: gpt-5 (top), gpt-4o (mid), gpt-4o-mini (economy)

### Google
- **Recommended for**: Cost-effective coding assistance
- **Strengths**: Large context window, fast inference
- **Models**: gemini-2-5-pro (top), gemini-2-5-flash (mid/economy)

### GitHub Copilot
- **Recommended for**: IDE-integrated workflow
- **Strengths**: Claude models via Copilot
- **Models**: claude-opus-4-6 (top), claude-sonnet-4-6 (mid), claude-haiku-4-6 (economy)
