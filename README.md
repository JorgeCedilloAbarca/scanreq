# ScanReq — Python Dependency Security Scanner

**ScanReq** scans your `requirements.txt` in real time, detects outdated packages via PyPI, and identifies CVE vulnerabilities via OSV.dev — all directly inside VS Code, with zero configuration.

---

## Features

- **Real-time PyPI check** — compares your pinned versions against the latest available
- **CVE detection** — queries OSV.dev for known vulnerabilities on exact versions (`==`)
- **Visual results panel** — color-coded table with version status and security badges
- **Smart insights** — contextual alerts: critical CVEs, bulk update warnings, actionable advice
- **Status bar badge** — red/orange/green indicator at a glance, click to open the panel
- **Auto-refresh** — panel updates automatically when `requirements.txt` is saved
- **English & Spanish** — UI language follows your VS Code language setting
- **Full pip operator support** — `==`, `>=`, `<=`, `>`, `<`, `!=`, `~=`, and ranges
- **Extras support** — handles `uvicorn[standard]==0.27.0` correctly
- **UTF-8 and UTF-16** encoding support for `requirements.txt`

---

## How it works

1. Open any Python project that contains a `requirements.txt`
2. ScanReq activates automatically and runs a scan in the background
3. The status bar shows the health of your dependencies at a glance
4. Click the badge or run **ScanReq: Analizar requirements.txt** from the Command Palette to open the full panel

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `scanreq.autoOpenPanel` | `false` | Open the results panel automatically on startup or when `requirements.txt` changes |
| `scanreq.showNotification` | `true` | Show a progress notification while the scan is running |

---

## Free vs Pro

| Feature | Free | Pro |
|---|---|---|
| PyPI version check | ✅ | ✅ |
| CVE detection (exact versions `==`) | ✅ | ✅ |
| Visual results panel | ✅ | ✅ |
| Smart insights | ✅ | ✅ |
| CVE detection for non-exact versions (`>=`, `~=`…) | ❌ | ✅ |
| Auto-detect installed version via pip | ❌ | ✅ |
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

No external tools required for the Free plan. ScanReq uses the PyPI JSON API and OSV.dev API directly — no pip, no Python installation needed.

For Pro features, pip must be available in your PATH for auto-detection of installed versions. If pip is not found, ScanReq shows a clear notice inside the panel.

---

## Privacy

ScanReq does not collect any telemetry or personal data. Package names and versions are sent only to PyPI (pypi.org) and OSV.dev for vulnerability lookups. License tokens are validated against scanreq.com.