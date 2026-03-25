# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-03-25

### Added

- Custom display names for builtin agents — configure `display_name` in agent overrides to rename agents in the UI ([4634f65](https://github.com/pgermishuys/opencode-weave/commit/4634f65))
- Phase 1 agent eval harness with expanded coverage and baselines ([3c1862d](https://github.com/pgermishuys/opencode-weave/commit/3c1862d), [c83b406](https://github.com/pgermishuys/opencode-weave/commit/c83b406))

### Fixed

- Eliminate cross-test state pollution in `scanDirectory` spy and display name maps ([0c56483](https://github.com/pgermishuys/opencode-weave/commit/0c56483))

## [0.7.0] - 2026-03-14

### Added

- Declarative workflow engine with template+instance model — define multi-step agentic pipelines as YAML templates ([63ac851](https://github.com/pgermishuys/weave/commit/63ac851))
- Token usage tracking, cost accumulation, and `/token-report` slash command ([aabe11e](https://github.com/pgermishuys/weave/commit/aabe11e), [0c34dd7](https://github.com/pgermishuys/weave/commit/0c34dd7))
- Metrics analytics wiring and `/metrics` slash command ([fa55a6c](https://github.com/pgermishuys/weave/commit/fa55a6c))
- Preview release publishing support — prerelease versions publish to `next` dist-tag on npm ([a93374f](https://github.com/pgermishuys/weave/commit/a93374f))
- Collision guards between workflow engine and work-state system to prevent double-prompting ([f4e106e](https://github.com/pgermishuys/weave/commit/f4e106e))
- Todo finalization safety net — auto-injects a prompt to mark lingering `in_progress` todos complete when a session goes idle ([aa300de](https://github.com/pgermishuys/weave/commit/aa300de))
- Emphatic `BEFORE FINISHING (MANDATORY)` block in Loom and Tapestry sidebar prompts ([aa300de](https://github.com/pgermishuys/weave/commit/aa300de))
- Model selection guide for agent configuration ([3024faf](https://github.com/pgermishuys/weave/commit/3024faf))

### Fixed

- Decouple `use_fingerprint` from `analytics.enabled` — now an independent opt-in ([0950d52](https://github.com/pgermishuys/weave/commit/0950d52))
- Remove implicit fingerprint generation from `createAnalytics` ([e26336f](https://github.com/pgermishuys/weave/commit/e26336f))
- Avoid O(n²) file I/O in JSONL rotation by using a size gate ([8e69018](https://github.com/pgermishuys/weave/commit/8e69018))
- Use `path.sep` in prompt-loader sandbox check for Windows compatibility ([dce3564](https://github.com/pgermishuys/weave/commit/dce3564))
- Use `path.join` for cross-platform path assertion in loader tests ([dc9aad4](https://github.com/pgermishuys/weave/commit/dc9aad4))
- Resolve CodeQL security alerts for insecure temp files and TOCTOU races ([4cfc30b](https://github.com/pgermishuys/weave/commit/4cfc30b))
- Remove unused imports flagged by CodeQL ([6ada3f9](https://github.com/pgermishuys/weave/commit/6ada3f9))

## [0.6.4] - 2026-03-08

### Added

- Invalidate fingerprint cache on version upgrade ([696bbe6](https://github.com/pgermishuys/weave/commit/696bbe6))

## [0.6.3] - 2026-03-06

### Added

- Wire custom agent triggers into Loom's system prompt ([4960b90](https://github.com/pgermishuys/weave/commit/4960b90))
- E2E regression tests for the configurable agent framework ([c6b2ac7](https://github.com/pgermishuys/weave/commit/c6b2ac7))

### Fixed

- Include auto-pause logic in plugin-interface to fix CI ([45f0b1c](https://github.com/pgermishuys/weave/commit/45f0b1c))
- Add stale progress detection and session scoping to prevent infinite continuation loops ([7a80702](https://github.com/pgermishuys/weave/commit/7a80702))

## [0.6.2] - 2026-02-28

### Fixed

- Replace in-memory `pendingInterrupt` with persistent `paused` flag on `WorkState` — eliminates race condition and one-shot consumption bugs in interrupt handling ([d7d8acf](https://github.com/pgermishuys/weave/commit/d7d8acf))

## [0.6.1] - 2026-02-28

### Added

- Add 3-second timeout to skill fetch to support lazy loading without blocking startup ([8cc586f](https://github.com/pgermishuys/weave/commit/8cc586f))

### Fixed

- Honor user interrupts by suppressing work-continuation after `session.interrupt` ([c16e89a](https://github.com/pgermishuys/weave/commit/c16e89a))

## [0.6.0] - 2026-02-26

### Added

- Replace filesystem skill scanning with OpenCode SDK integration — skills are now loaded via the SDK HTTP endpoint instead of filesystem discovery ([8a15dc5](https://github.com/pgermishuys/weave/commit/8a15dc5))
- Move post-execution review into Tapestry with start SHA tracking for cross-session diffs ([4f4216a](https://github.com/pgermishuys/weave/commit/4f4216a))
- Automated post-execution review handoff to Loom after Tapestry completes ([9bdfb7b](https://github.com/pgermishuys/weave/commit/9bdfb7b))
- Tapestry per-task self-verification protocol ([f8d863e](https://github.com/pgermishuys/weave/commit/f8d863e))

### Fixed

- Resolve config-defined skills in agent overrides ([62765f1](https://github.com/pgermishuys/weave/commit/62765f1))
- Tapestry reports review findings instead of autonomously fixing them ([99f5a14](https://github.com/pgermishuys/weave/commit/99f5a14))
- Direct users to Loom (not Pattern) for plan creation ([8ee1518](https://github.com/pgermishuys/weave/commit/8ee1518))
- Prevent post-execution review loop by tracking `review_triggered` flag ([5183e04](https://github.com/pgermishuys/weave/commit/5183e04))
- Use display name for Loom in work-continuation handoff ([95c2752](https://github.com/pgermishuys/weave/commit/95c2752))
- Route post-execution review to Loom when plan completes ([2e4dc5c](https://github.com/pgermishuys/weave/commit/2e4dc5c))
- Fix `/start-work` command — remove agent field so Loom stays active and delegates to Tapestry ([7d76683](https://github.com/pgermishuys/weave/commit/7d76683), [6f823b0](https://github.com/pgermishuys/weave/commit/6f823b0), [b6f1bac](https://github.com/pgermishuys/weave/commit/b6f1bac))

### Changed

- Streamline Tapestry verification — removed automated checks, type/build checks, and git diff in favor of Edit/Write tool call history and LSP-based error detection ([b224bac](https://github.com/pgermishuys/weave/commit/b224bac), [258c21d](https://github.com/pgermishuys/weave/commit/258c21d), [05f36b9](https://github.com/pgermishuys/weave/commit/05f36b9))
- Remove Tapestry→Loom agent-switch hacks and mandatory post-execution review gate ([da184b3](https://github.com/pgermishuys/weave/commit/da184b3))
- Clear `state.json` on plan completion so `session.idle` takes fast exit path ([13df42e](https://github.com/pgermishuys/weave/commit/13df42e))

[0.7.0]: https://github.com/pgermishuys/weave/compare/v0.6.4...v0.7.0
[0.6.4]: https://github.com/pgermishuys/weave/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/pgermishuys/weave/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/pgermishuys/weave/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/pgermishuys/weave/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/pgermishuys/weave/compare/v0.5.2...v0.6.0
