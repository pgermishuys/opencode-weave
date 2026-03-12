# Releasing

This document covers how to publish stable and preview releases of `@opencode_weave/weave` to npm.

## How It Works

All publishing is handled by the GitHub Actions workflow in `.github/workflows/publish.yml`. The pipeline:

1. Checks out the code
2. Installs dependencies, runs typecheck, tests, and build
3. Sets the package version from the git tag (or manual input)
4. Publishes to npm with the appropriate dist-tag
5. Notifies `weave-website` to update the version badge (stable releases only)

## Dist-Tags

| Dist-tag | Used for | Install command |
|----------|----------|-----------------|
| `latest` | Stable releases (`0.7.0`) | `npm install @opencode_weave/weave` |
| `next` | Preview/prerelease versions (`0.7.0-beta.1`) | `npm install @opencode_weave/weave@next` |

All prerelease types (`alpha`, `beta`, `rc`, `preview`, etc.) publish to `next`. There are no separate dist-tags per prerelease type.

## Version Conventions

This project follows [Semantic Versioning](https://semver.org/):

- **Stable**: `MAJOR.MINOR.PATCH` (e.g., `0.7.0`, `1.0.0`)
- **Prerelease**: `MAJOR.MINOR.PATCH-IDENTIFIER.N` (e.g., `0.7.0-beta.1`, `1.0.0-rc.1`)

Common prerelease identifiers:
- `-alpha.N` — early development, unstable
- `-beta.N` — feature-complete but not fully tested
- `-rc.N` — release candidate, expected to be stable
- `-preview.N` — general preview

The presence of a hyphen (`-`) in the version string is what determines whether a release is treated as a prerelease. This follows the SemVer spec.

## Stable Release

### Checklist

1. **Bump the version** in `package.json`:
   ```json
   "version": "0.7.0"
   ```

2. **Update `CHANGELOG.md`** with the new version entry. Follow the existing [Keep a Changelog](https://keepachangelog.com/) format:
   ```markdown
   ## [0.7.0] - YYYY-MM-DD

   ### Added
   - ...

   ### Changed
   - ...

   ### Fixed
   - ...
   ```

3. **Commit and push** the version bump and changelog update to `main`.

4. **Create a GitHub Release**:
   - Go to [Releases](https://github.com/pgermishuys/weave/releases/new)
   - Tag: `v0.7.0` (must be `v`-prefixed)
   - Target: `main`
   - Title: `v0.7.0`
   - Description: Copy the changelog entry or write a summary
   - **Do NOT** check "Set as a pre-release"
   - Click "Publish release"

5. The workflow triggers automatically and:
   - Publishes to npm with `--tag latest`
   - Dispatches to `weave-website` to update the version badge

6. **Verify**: Run `npm view @opencode_weave/weave version` to confirm the new version is live.

## Preview Release

There are two ways to publish a preview release.

### Option A: GitHub Release (recommended)

1. **Do NOT** bump the version in `package.json` on `main` — the workflow sets it from the tag.

2. **Create a GitHub Release**:
   - Tag: `v0.7.0-beta.1` (prerelease identifier in the tag)
   - Target: `main` (or the relevant branch)
   - Title: `v0.7.0-beta.1`
   - Check "Set as a pre-release" (optional — the workflow detects prereleases from the version string, not the checkbox)
   - Click "Publish release"

3. The workflow triggers automatically and:
   - Publishes to npm with `--tag next`
   - **Skips** the website dispatch

### Option B: Manual Workflow Dispatch

1. Go to [Actions → Publish to npm](https://github.com/pgermishuys/weave/actions/workflows/publish.yml)
2. Click "Run workflow"
3. Enter the version (e.g., `0.7.0-beta.1`) — no `v` prefix needed
4. Click "Run workflow"

This publishes directly from the current `main` branch without creating a GitHub Release. Useful for quick preview iterations.

### Incrementing Preview Versions

For successive previews, increment the numeric suffix:
- `0.7.0-beta.1` → `0.7.0-beta.2` → `0.7.0-beta.3`
- `0.7.0-rc.1` → `0.7.0-rc.2`

### Verify

```bash
# Check what's published under "next"
npm view @opencode_weave/weave dist-tags

# Install the preview version
npm install @opencode_weave/weave@next
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `npm publish` fails with 403 | `NPM_TOKEN` secret expired or missing | Regenerate the token and update the repository secret |
| Version already exists on npm | Tag reuses an existing version | Use a new version number |
| Website not updating after stable release | `WEBSITE_DISPATCH_TOKEN` expired | Regenerate and update the secret |
| Preview published to `latest` | Tag missing the prerelease identifier (hyphen) | Ensure the version contains `-` (e.g., `0.7.0-beta.1`, not `0.7.0beta1`) |
