# Changelog

All notable changes to ScanReq will be documented in this file.

## [2.1.0] - 2026-05-01

### Added
- **Multi-ecosystem architecture** — new `EcosystemAdapter` interface allows adding new languages without touching existing code
- **Node.js support** — scans `package.json` (dependencies, devDependencies, peerDependencies, optionalDependencies) via npm registry + OSV.dev
- **Auto-detection of installed npm versions** — reads directly from `node_modules` without requiring npm in PATH
- **Multi-ecosystem panel** — when multiple dependency files are detected, the panel shows each ecosystem as a separate section

### Changed
- Python modules moved to `src/ecosystems/python/` — behavior unchanged
- `osv.ts` now accepts `ecosystem` as an explicit parameter (PyPI, npm, crates.io...)
- `extension.ts` now watches all registered dependency files simultaneously
- `webview.ts` now renders one section per ecosystem when multiple are present
- AI prompt export now includes all ecosystems in a single structured prompt

### Fixed
- Compatibility analysis texts (conflicts and safe updates) now correctly follow VS Code language setting
- Duplicate packages from `peerDependencies` no longer appear twice in the Node.js results

## [2.0.0] - 2026-04-30

### Added
- **Pro plan** — full CVE coverage for non-exact version specifiers (`>=`, `~=`, ranges)
- **pip integration** — auto-detects installed package versions via `pip show`
- **Cross-version compatibility analysis** — detects dependency conflicts by cross-referencing `requires_dist` from PyPI
- **Safe update recommendations** — prioritized by CVE severity and conflict resolution
- **AI prompt export** — one-click copy of a structured prompt for Claude, Copilot or Cursor
- **License activation** — `ScanReq: Activar Plan Pro` command with token validation against scanreq.com
- **License deactivation** — `ScanReq: Desactivar Plan Pro` command
- **Pro badge** in panel header — shows `⚡ Pro` or `👑 Admin` when license is active
- **pip unavailable warning** — clear notice in the panel if pip is not found in PATH
- Argument for using Pro over AI agents — cost comparison included in Free plan insights

### Changed
- Panel now shows `pip` tag on versions auto-detected via pip
- Non-exact versions show `∼ Sin fijar / ∼ Unpinned` badge instead of being silently skipped
- Free plan insights now include cost comparison vs AI agents (~$0.85/scan)
- Status bar and panel fully updated to reflect Pro vs Free state

## [1.0.0] - 2026-04-29

### Added
- Real-time PyPI version checking for all packages in `requirements.txt`
- CVE vulnerability detection via OSV.dev for exact versions (`==`)
- Visual results panel with color-coded badges (red/orange/green)
- Smart contextual insights — critical alerts, update warnings, and actionable advice
- Status bar badge showing dependency health at a glance (click to open panel)
- Auto-refresh — panel updates automatically when `requirements.txt` is saved
- English and Spanish support based on VS Code language setting
- Support for all pip version operators (`==`, `>=`, `<=`, `>`, `<`, `!=`, `~=`, ranges)
- Approximate version display (`∼x.y.z`) for non-exact specifiers
- `scanreq.autoOpenPanel` setting — control whether the panel opens automatically
- `scanreq.showNotification` setting — control progress notification visibility
- UTF-8 and UTF-16 (LE/BE with BOM) encoding support for `requirements.txt`
- Inline comment support in `requirements.txt` (e.g. `flask==3.0.0  # web framework`)
- Extras support (e.g. `uvicorn[standard]==0.27.0`)