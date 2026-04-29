# Changelog

All notable changes to ScanReq will be documented in this file.

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
- `— Pro` badge for packages without exact versions (CVE analysis requires Pro)
- `scanreq.autoOpenPanel` setting — control whether the panel opens automatically
- `scanreq.showNotification` setting — control progress notification visibility
- UTF-8 and UTF-16 (LE/BE with BOM) encoding support for `requirements.txt`
- Inline comment support in `requirements.txt` (e.g. `flask==3.0.0  # web framework`)
- Extras support (e.g. `uvicorn[standard]==0.27.0`)
