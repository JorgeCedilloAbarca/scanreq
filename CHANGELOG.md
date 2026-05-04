# Changelog

All notable changes to ScanReq will be documented in this file.

## [2.3.0] - 2026-05-04

### Added
- **PHP support** — scans `composer.json` via Packagist API + OSV.dev (ecosystem: Packagist)
  - Reads `composer.lock` for precise installed versions when available
  - Supports `require` and `require-dev` sections
  - Supports all Composer version specifiers: exact, `^`, `~`, `>=`, wildcards, OR ranges
  - Ignores `php`, `ext-*`, `lib-*` entries and `dev-*` branch references
- **Ruby support** — scans `Gemfile` via RubyGems API + OSV.dev (ecosystem: RubyGems)
  - Reads `Gemfile.lock` for precise installed versions when available (Bundler format)
  - Supports gem groups (`:test`, `:development`, `:development, :test`, etc.)
  - Supports all Ruby version specifiers: exact, `~>`, `>=`, `<=`, `!=`, ranges
  - Handles platform-specific versions in Gemfile.lock (e.g. `nokogiri (1.16.0-x86_64-linux)`)
  - Ignores `:git`, `:github`, `:path` gem references
- **Go transitive conflict detection** — `go mod graph` support (Pro)
  - Detects if Go is available in PATH (`go version`)
  - Runs `go mod graph` in the workspace directory containing `go.mod`
  - Parses the dependency graph to identify transitive version conflicts
  - Reports conflicts where a transitive dependency requires a higher version than `go.mod` declares
  - If Go is not in PATH, falls back to safe updates only (same as v2.2) with `toolUnavailable: true`
- `gotools.ts` — new module: `checkGoAvailability()`, `runGoModGraph()`, `parseModuleRef()`
- Unit tests for PHP parser: 18 tests covering all specifiers, sections, lock file, edge cases
- Unit tests for Ruby parser: 18 tests covering all specifiers, groups, Gemfile.lock, edge cases

### Changed
- `registry.ts` — PHP and Ruby adapters now active (previously commented as `← v2.3`)
- `go/adapter.ts` — passes `filePath` to `runCompatibilityAnalysis` for `go mod graph`
- `go/compatibility.ts` — new signature `runCompatibilityAnalysis(packages, goModPath, toolUnavailable)`
- `package.json` — version bumped to `2.3.0`; `activationEvents` and `keywords` updated for PHP/Ruby
- `README.md` — ecosystem table, features, requirements, and privacy sections updated

## [2.2.1] - 2026-05-04

### Added
- **Compatibility analysis for Node.js** — detects peer dependency conflicts via npm registry
- **Compatibility analysis for Rust** — detects dependency conflicts via crates.io dependencies API
- **Compatibility analysis for Go** — safe update recommendations (dependency conflict analysis pending `go mod graph` support in v2.3)
- **Major version badge** — `⚠ Major` / `⚠ +N major` badge in the version column when a major version jump is detected (Pro only)
- **Phased safe update table** — updates organized in three phases by migration risk: low / medium / high (Pro only)
- **Unit tests** — 68 tests across 5 files covering all parsers and type helpers (Vitest)
- `calcMajorVersionJump()` and `calcMigrationRisk()` exported helpers in `types.ts`
- `majorVersionJump` field in `PackageResult` (all 4 ecosystems)
- `migrationRisk` field in `SafeUpdate`

### Fixed
- `calcMajorVersionJump` returned incorrect values for non-numeric versions (`unknown`, `Not found`)
- Rust table-format dependencies (`serde = { version = "1.0" }`) were incorrectly marked as `exactVersion: true`

### Changed
- README updated: Major badge feature, phased updates section, Pro feature table

## [2.2.0] - 2026-05-01

### Added
- **Rust support** — scans `Cargo.toml` (dependencies, dev-dependencies, build-dependencies) via crates.io API + OSV.dev
- **Go support** — scans `go.mod` via Go module proxy (proxy.golang.org) + OSV.dev
- Rust parser supports simple format (`serde = "1.0"`) and table format (`serde = { version = "1.0", features = [...] }`)
- Go parser supports single-line and block `require (...)` directives, strips `v` prefix for version normalization
- crates.io requests use proper User-Agent per crates.io policy
- Go module proxy encoding for uppercase letters in module paths

### Changed
- `package.json` activationEvents now include `Cargo.toml` and `go.mod`
- Description and keywords updated to reflect all four supported ecosystems

## [2.1.2] - 2026-05-01

### Fixed
- Panel subtitle now shows dynamically which files are being scanned (e.g. `requirements.txt · package.json`)
