# Changelog

All notable changes to ScanReq will be documented in this file.

## [2.4.1] - 2026-05-04

### Added
- **Java (Gradle) support** — scans `build.gradle` and `build.gradle.kts` via Maven Central + OSV.dev
  - Supports Groovy DSL (string format `'g:a:v'` and named format `group:, name:, version:`)
  - Supports Kotlin DSL (`implementation("g:a:v")` and `group =, name =, version =`)
  - Resolves version variables defined in the same file (`def`/`val`/`var`)
  - Supports all configurations: `implementation`, `api`, `compileOnly`, `runtimeOnly`, `testImplementation`, `kapt`, `ksp`, `annotationProcessor` and more
  - Reuses Maven Central registry and compatibility analysis from `java/` — no duplication
  - 22 unit tests covering Groovy DSL, Kotlin DSL, named format, variables, exclusions

### Fixed
- Gradle parser: line-by-line iteration replaces `gm` regex to correctly detect all dependencies in a block

### Changed
- `types.ts` — `EcosystemId` now includes `'gradle'`
- `registry.ts` — `gradleAdapter` registered
- `webview.ts` — Gradle icon (🐘) and Maven Central link added
- `package.json` — version `2.4.1`; `activationEvents` include `build.gradle` and `build.gradle.kts`

## [2.4.0] - 2026-05-04

### Added
- **Java (Maven) support** — scans `pom.xml` via Maven Central Search API + OSV.dev (ecosystem: Maven)
  - Resolves `${property}` version references from `<properties>` and `${project.version}`
  - Supports `<dependencies>` and `<dependencyManagement>` sections
  - All scopes supported: compile, test, provided, runtime, system
  - Ignores BOM imports (`type=pom`, `scope=import`)
  - Marks SNAPSHOT, LATEST, RELEASE and unresolved properties as non-exact
  - 20 unit tests covering properties resolution, scopes, dependencyManagement, edge cases
- **PHP conflict detection** (Pro) — fetches `require` from Packagist API latest release and checks installed versions against Composer specifiers (`^`, `~`, `>=`, `<=`, `>`, `<`, `!=`, `=`, wildcards, OR/AND)
- **Ruby conflict detection** (Pro) — fetches `dependencies.runtime` from RubyGems API and resolves `~>` (pessimistic) and standard operators; normalizes gem name aliases (hyphens/underscores)

### Changed
- `types.ts` — `EcosystemId` now includes `'java'`; `OsvEcosystem` now includes `'Maven'`
- `registry.ts` — `javaAdapter` registered
- `webview.ts` — Java icon (☕) and Maven Central registry link added
- `package.json` — version `2.4.0`; `activationEvents` include `pom.xml`
- `php/compatibility.ts` — full conflict detection replaces stub
- `ruby/compatibility.ts` — full conflict detection replaces stub

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
  - If Go is not in PATH, falls back to safe updates only with `toolUnavailable: true`
- `gotools.ts` — new module: `checkGoAvailability()`, `runGoModGraph()`, `parseModuleRef()`
- Unit tests for PHP parser: 18 tests
- Unit tests for Ruby parser: 18 tests

### Changed
- `registry.ts` — PHP and Ruby adapters active
- `go/adapter.ts` — passes `filePath` to `runCompatibilityAnalysis` for `go mod graph`
- `go/compatibility.ts` — new signature `runCompatibilityAnalysis(packages, goModPath, toolUnavailable)`
- `package.json` — version `2.3.0`; `activationEvents` and `keywords` updated for PHP/Ruby

## [2.2.1] - 2026-05-04

### Added
- **Compatibility analysis for Node.js** — detects peer dependency conflicts via npm registry
- **Compatibility analysis for Rust** — detects dependency conflicts via crates.io dependencies API
- **Compatibility analysis for Go** — safe update recommendations
- **Major version badge** — `⚠ Major` / `⚠ +N major` badge in the version column (Pro only)
- **Phased safe update table** — updates organized in three phases by migration risk: low / medium / high (Pro only)
- **Unit tests** — 68 tests across 5 files covering all parsers and type helpers (Vitest)
- `calcMajorVersionJump()` and `calcMigrationRisk()` exported helpers in `types.ts`
- `majorVersionJump` field in `PackageResult`
- `migrationRisk` field in `SafeUpdate`

### Fixed
- `calcMajorVersionJump` returned incorrect values for non-numeric versions (`unknown`, `Not found`)
- Rust table-format dependencies (`serde = { version = "1.0" }`) were incorrectly marked as `exactVersion: true`

## [2.2.0] - 2026-05-01

### Added
- **Rust support** — scans `Cargo.toml` via crates.io API + OSV.dev
- **Go support** — scans `go.mod` via Go module proxy + OSV.dev
- Rust parser supports simple and table format
- Go parser supports single-line and block `require (...)` directives
- crates.io requests use proper User-Agent per crates.io policy

### Changed
- `activationEvents` now include `Cargo.toml` and `go.mod`

## [2.1.2] - 2026-05-01

### Fixed
- Panel subtitle now shows dynamically which files are being scanned
