# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.6.1]: https://github.com/pgermishuys/weave/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/pgermishuys/weave/compare/v0.5.2...v0.6.0
