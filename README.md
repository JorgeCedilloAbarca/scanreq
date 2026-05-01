# ScanReq — Multi-Ecosystem Dependency Security Scanner

**ScanReq** scans your project dependencies in real time, detects outdated packages via public registries, and identifies CVE vulnerabilities via OSV.dev — all directly inside VS Code, with zero configuration.

---

## Supported Ecosystems

| Ecosystem | File | Registry | CVE source |
|---|---|---|---|
| 🐍 Python | `requirements.txt` | PyPI | OSV.dev |
| 🟩 Node.js | `package.json` | npm | OSV.dev |

More ecosystems coming in v2.2 — Rust, Go, PHP, Ruby.

---

## Features

- **Multi-ecosystem support** — detects and scans all dependency files found in your workspace automatically
- **Real-time registry check** — compares your pinned versions against the latest available on PyPI and npm
- **CVE detection** — queries OSV.dev for known vulnerabilities on exact versions (`==`, fixed)
- **Visual results panel** — color-coded table with version status and security badges, one section per ecosystem
- **Smart insights** — contextual alerts: critical CVEs, bulk update warnings, actionable advice
- **Status bar badge** — red/orange/green indicator at a glance, click to open the panel
- **Auto-refresh** — panel updates automatically when any dependency file is saved
- **English & Spanish** — UI language follows your VS Code language setting
- **Full version specifier support** — `==`, `>=`, `<=`, `>`, `<`, `!=`, `~=`, `^`, `~` and ranges
- **Extras support** — handles `uvicorn[standard]==0.27.0` correctly
- **UTF-8 and UTF-16** encoding support

---

## How it works

1. Open any project that contains a `requirements.txt` or `package.json`
2. ScanReq activates automatically and runs a scan in the background
3. The status bar shows the health of your dependencies at a glance
4. Click the badge or run **ScanReq: Scan dependencies** from the Command Palette to open the full panel

If your project has both files, the panel shows both ecosystems in a single view.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `scanreq.autoOpenPanel` | `false` | Open the results panel automatically on startup or when a dependency file changes |
| `scanreq.showNotification` | `true` | Show a progress notification while the scan is running |

---

## Free vs Pro

| Feature | Free | Pro |
|---|---|---|
| All ecosystems (Python, Node.js…) | ✅ | ✅ |
| Registry version check | ✅ | ✅ |
| CVE detection (exact versions) | ✅ | ✅ |
| Visual results panel | ✅ | ✅ |
| Smart insights | ✅ | ✅ |
| CVE detection for non-exact versions (`>=`, `^`, `~=`…) | ❌ | ✅ |
| Auto-detect installed version (pip / node_modules) | ❌ | ✅ |
| Cross-version compatibility analysis | ❌ | ✅ |
| Dependency conflict detection | ❌ | ✅ |
| Safe update recommendations | ❌ | ✅ |
| 🤖 AI prompt export (Claude, Copilot, Cursor) | ❌ | ✅ |

Upgrade at [scanreq.com](https://scanreq.com)

---

## Activating Pro

1. Get your license at [scanreq.com/pricing](https://scanreq.com/pricing)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run **ScanReq: Activar Plan Pro**
4. Enter your license token — Pro activates instantly

---

## Requirements

No external tools required for the Free plan. ScanReq queries PyPI, npm registry, and OSV.dev directly — no pip, no Node.js installation needed.

For Pro features:
- **Python** — pip must be available in your PATH for auto-detection of installed versions. If pip is not found, ScanReq shows a clear notice inside the panel.
- **Node.js** — ScanReq reads directly from `node_modules` without requiring npm in PATH. If `node_modules` does not exist, run `npm install` first.

---

## Privacy

ScanReq does not collect any telemetry or personal data. Package names and versions are sent only to PyPI (pypi.org), npm registry (registry.npmjs.org), and OSV.dev for vulnerability lookups. License tokens are validated against scanreq.com.
