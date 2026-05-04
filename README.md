# ScanReq — Multi-Ecosystem Dependency Security Scanner

**ScanReq** scans your project dependencies in real time, detects outdated packages via public registries, and identifies CVE vulnerabilities via OSV.dev — all directly inside VS Code, with zero configuration.

---

## Supported Ecosystems

| Ecosystem | File | Registry | CVE source |
|---|---|---|---|
| 🐍 Python | `requirements.txt` | PyPI | OSV.dev |
| 🟩 Node.js | `package.json` | npm | OSV.dev |
| 🦀 Rust | `Cargo.toml` | crates.io | OSV.dev |
| 🔵 Go | `go.mod` | proxy.golang.org | OSV.dev |
| 🐘 PHP | `composer.json` | Packagist | OSV.dev |
| 💎 Ruby | `Gemfile` | RubyGems | OSV.dev |
| ☕ Java (Maven) | `pom.xml` | Maven Central | OSV.dev |
| 🐘 Java (Gradle) | `build.gradle` / `build.gradle.kts` | Maven Central | OSV.dev |

---

## Features

- **Multi-ecosystem support** — detects and scans all dependency files found in your workspace automatically
- **Real-time registry check** — compares your pinned versions against the latest available on PyPI, npm, crates.io, the Go module proxy, Packagist, RubyGems and Maven Central
- **CVE detection** — queries OSV.dev for known vulnerabilities on exact versions
- **Visual results panel** — color-coded table with version status and security badges, one section per ecosystem
- **Major version badge** — flags packages with breaking-change risk when a major version jump is detected (Pro)
- **Smart insights** — contextual alerts: critical CVEs, bulk update warnings, actionable advice
- **Status bar badge** — red/orange/green indicator at a glance, click to open the panel
- **Auto-refresh** — panel updates automatically when any dependency file is saved
- **English & Spanish** — UI language follows your VS Code language setting
- **Full version specifier support** — `==`, `>=`, `<=`, `>`, `<`, `!=`, `~=`, `^`, `~`, `~>` and ranges
- **Lock file support** — reads `composer.lock` and `Gemfile.lock` for precise installed versions
- **Extras support** — handles `uvicorn[standard]==0.27.0` correctly
- **UTF-8 and UTF-16** encoding support

---

## How it works

1. Open any project that contains a supported dependency file (`requirements.txt`, `package.json`, `Cargo.toml`, `go.mod`, `composer.json`, `Gemfile`, `pom.xml`, `build.gradle` or `build.gradle.kts`)
2. ScanReq activates automatically and runs a scan in the background
3. The status bar shows the health of your dependencies at a glance
4. Click the badge or run **ScanReq: Scan dependencies** from the Command Palette to open the full panel

If your project has multiple dependency files, the panel shows each ecosystem as a separate section in a single view.

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
| All ecosystems (Python, Node.js, Rust, Go, PHP, Ruby, Java) | ✅ | ✅ |
| Registry version check | ✅ | ✅ |
| CVE detection (exact versions) | ✅ | ✅ |
| Visual results panel | ✅ | ✅ |
| Smart insights | ✅ | ✅ |
| CVE detection for non-exact versions (`>=`, `^`, `~=`…) | ❌ | ✅ |
| Auto-detect installed version (pip / node_modules) | ❌ | ✅ |
| Cross-version compatibility analysis | ❌ | ✅ |
| Dependency conflict detection | ❌ | ✅ |
| Go transitive conflict analysis (`go mod graph`) | ❌ | ✅ |
| Safe updates — phased by migration risk (low / medium / high) | ❌ | ✅ |
| ⚠ Major version badge — flags breaking change risk | ❌ | ✅ |
| 🤖 AI prompt export (Claude, Copilot, Cursor) | ❌ | ✅ |

Upgrade at [scanreq.com](https://scanreq.com)

---

## Pro — Safe Update Phases

When Pro is active, the safe update recommendations are organized into three phases to help you prioritize without breaking your project:

- **Phase 1 — Low risk**: patch or minor updates with no CVEs. Apply directly.
- **Phase 2 — Medium risk**: updates with CVEs, or a single major version jump. Review the changelog first.
- **Phase 3 — High risk (Major)**: two or more major version jumps. Review your code for breaking changes before updating.

Within each phase, packages with CVEs are listed first.

---

## Activating Pro

1. Get your license at [scanreq.com/pricing](https://scanreq.com/pricing)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run **ScanReq: Activar Plan Pro**
4. Enter your license token — Pro activates instantly

---

## Requirements

No external tools required for any ecosystem. ScanReq queries all registries directly — no local tools needed.

For Pro features:
- **Python** — pip must be available in your PATH for auto-detection of installed versions. If pip is not found, ScanReq shows a clear notice inside the panel.
- **Node.js** — ScanReq reads directly from `node_modules` without requiring npm in PATH. If `node_modules` does not exist, run `npm install` first.
- **Rust** — no local tools required. Cargo.toml always contains explicit versions.
- **Go** — if Go is installed and available in your PATH, ScanReq runs `go mod graph` to detect transitive dependency conflicts. Without Go in PATH, safe update recommendations are still available.
- **PHP** — no local tools required. If `composer.lock` is present, it is used for precise installed versions.
- **Ruby** — no local tools required. If `Gemfile.lock` is present, it is used for precise installed versions.
- **Java (Maven / Gradle)** — no local tools required. Versions are read directly from `pom.xml` or `build.gradle` / `build.gradle.kts`.

---

## Privacy

ScanReq does not collect any telemetry or personal data. Package names and versions are sent only to the relevant public registries (PyPI, npm, crates.io, proxy.golang.org, repo.packagist.org, rubygems.org, search.maven.org) and to OSV.dev for vulnerability lookups. License tokens are validated against scanreq.com.
