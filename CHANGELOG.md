# Changelog

All notable changes to ScanReq will be documented in this file.

## [2.6.0] - 2026-05-21

### Added
- **Pro plan now available** — purchase at [scanreq.com/pricing](https://scanreq.com/pricing). One-time payment, no subscription. License token delivered instantly by email after purchase.
- **Token recovery link in error messages** — when a token is not found or invalid, the error message now includes a direct link to `scanreq.com/recover` so users can retrieve their token without contacting support.
- **Token recovery button on license revocation** — if a Pro license is silently revoked during background revalidation, the notification now includes a "Recover token" button that opens `scanreq.com/recover` directly.

## [2.5.4] - 2026-05-15

### Fixed
- **Screenshots not loading in Marketplace or VS Code** — image paths were relative (`images/screenshot1_clean.png`), which the VS Code Marketplace does not support. Replaced with absolute GitHub raw URLs (`https://raw.githubusercontent.com/...`).

## [2.5.3] - 2026-05-14

### Changed
- **README rewritten** — new marketing-focused structure: problem framing, clear Free vs Pro comparison, phased update table explained, price visible, and activation steps. Replaces the previous purely technical documentation.
- **Screenshots added** — three screenshots from real open-source GitHub projects: Node.js scan with CVEs on axios, Gradle scan with commons-io CVE, and Pro compatibility analysis with 3-phase migration table.

## [2.5.2] - 2026-05-14

### Fixed
- **Maven: `-GA`, `-Final`, `-jre11` ahora son versiones exactas** — `isExactVersion()` usaba una regex que solo aceptaba dígitos y puntos, rechazando sufijos de release válidos en Maven. `3.29.2-GA` se mostraba como `∼ Sin fijar` y no se analizaban sus CVEs.
- **Maven BOM: versiones internas del BOM ahora se resuelven** — `resolveBomVersions()` descargaba el BOM de Spring Boot pero no extraía sus `<properties>`. Dependencias como `postgresql` o `h2` sin versión declarada en el `pom.xml` se mostraban como `∼${postgresql.version}` en lugar de la versión real.
- **Maven: label según motivo de no disponibilidad** — en lugar de "Not found" para todos los casos, ahora se muestra "Versión dinámica" (SNAPSHOT), "Repositorio privado" (pom con `<repositories>` externos) o "No disponible" (no encontrado en Maven Central). Los paquetes con estos labels no generan entradas falsas en las fases ni badge `↑`.
- **Todas las fases: major jump siempre va a Fase 3** — `calcMigrationRisk` mezclaba CVEs y major jump en el mismo nivel `medium`. Ahora cualquier salto de major va a Fase 3 independientemente de si tiene CVEs.
- **Fases: `∼` en versión actual para paquetes no exactos** — la columna "Actual" de las fases ahora muestra `∼X.Y.Z` para paquetes con versión no fijada, consistente con la tabla principal.
- **Columna Versión: muestra actualización disponible para paquetes no exactos** — cuando `latestVersion` es conocida pero `exactVersion: false`, se muestra `↑ X.Y.Z disponible (∼)` en lugar de `∼ Sin fijar`, alineado con las sugerencias de las fases.
- **Prompt IA: inyección de contenido en el panel** — CVE summaries con backticks (como el de `wrangler pages deploy`) rompían el template literal del script inline, volcando el prompt como texto visible en el panel. El prompt ahora se codifica en Base64 (`Buffer`/`atob`) y se almacena en un `data-attribute`, eliminando cualquier posibilidad de inyección.

### Added
- **Fase `⚠ Sin parche disponible`** — paquetes al día según el registry pero con CVEs activos aparecen en una nueva fase. Si OSV reporta `fixedVersion`, se sugiere esa versión (verificando que exista en el registry para ese artefacto). Si no existe o no hay `fixedVersion`, se muestra "Sin parche conocido — evalúa mitigar o reemplazar".
- **OSV `fixedVersion`** — la consulta a OSV ahora extrae la versión de fix de cada CVE desde `affected[].ranges[].events`. Disponible en todos los ecosistemas.
- **Subtítulo colapsable en monorepos** — cuando hay más de 3 archivos escaneados, el subtítulo se convierte en un `<details>` colapsable que muestra "N archivos escaneados (click para ver)" y lista las rutas al expandir.

## [2.5.1] - 2026-05-14

### Security
- **Go package links: XSS/open-redirect fix** — Go was the only ecosystem where package names were not encoded in registry URLs. A malicious `go.mod` with a package named `javascript:...` could inject executable code into the webview. Fixed with `encodeURIComponent`.
- **CVE ordering before truncation** — CVEs are now sorted by severity (CRITICAL → HIGH → MEDIUM → LOW) before slicing. Previously, a CRITICAL could be hidden behind MEDIUMs if OSV returned them in that order. Limit raised from 3 to 5.
- **OSV `fixedVersion` now targets the correct patch branch** — the previous implementation always returned the globally highest `fixed` version, which could recommend a major branch upgrade (e.g. 2.3.1) when the user's installed version (e.g. 1.8.0) had a patch in its own branch (1.9.5). Now correctly filters OSV ranges by `introduced ≤ installed < fixed` and returns the minimum applicable fix.
- **OSV query timeout** — all OSV queries now abort after 10 seconds via `AbortController`. Previously, a slow or DNS-intercepted OSV endpoint would hang the entire scan indefinitely.
- **OSV 4xx/5xx logged distinctly from no-CVEs** — a 429 or 500 from OSV no longer silently returns `[]`, which was indistinguishable from a confirmed clean result. Errors are now logged via `console.warn`.
- **License token input masked** — the token input field now uses `password: true`. Previously the token was visible in plaintext while typing, exposing it in screencasts or pair programming sessions.
- **License revalidation interval reduced: 7 days → 24 hours** — a revoked token (chargeback, theft, token sharing) previously kept Pro access for up to 168 hours. Now capped at 24 hours.
- **`globalState` storage limitation documented** — VS Code stores extension state in plaintext on disk. Added explicit comment with filesystem paths so the risk is visible in code reviews. Users should not activate Pro on shared machines or CI environments.
- **AI prompt moved from DOM to JS closure** — the base64-encoded AI prompt was stored in a `data-prompt` DOM attribute, readable by any JS running in the webview via `getElementById().dataset`. It now lives in an IIFE closure, invisible to DOM traversal.

### Fixed
- **Unverified CVE badge** — packages with non-exact version specifiers now show `⚠ No verificado` / `⚠ Unverified` (orange) instead of the neutral grey `— No analizado` / `— Not analyzed`. The new badge includes a tooltip explaining that the version is not pinned and CVEs cannot be verified, with actionable advice.

## [2.5.0] - 2026-05-14

### Security
- **Removed hardcoded admin token** — admin token eliminated from source code and git history; license validation now goes entirely through the backend for all tokens
- **XSS prevention in webview** — added `escapeHtml()` sanitization for all external data (package names, versions, CVE summaries, file paths) before rendering in the panel
- **Content Security Policy** — added strict CSP header to the webview HTML (`default-src 'none'`, `connect-src 'none'`) blocking any network requests from the panel
- **Periodic license revalidation** — Pro licenses are silently revalidated against the backend every 7 days; revoked licenses (e.g. chargebacks) are automatically deactivated without user action
- **Rate limiting on license validation** — backend endpoint `/api/validate-license` now enforces a limit of 10 attempts per IP per hour via Cloudflare KV
- **Symlink protection in file walker** — symbolic links are now ignored during workspace scanning to prevent path traversal outside the workspace
- **Reduced timeouts and output limits** — `pip show` reduced from 10s to 5s, `pip list` from 15s to 10s, `go mod graph` from 30s to 15s; `maxBuffer` limits added to all subprocess calls
- **Package name validation** — pip package names are validated against `/^[a-zA-Z0-9._-]+$/` before being passed to subprocess calls
- **Registry URLs hardened** — all registry links now use `encodeURIComponent()` on package names

### Added
- **Unpatched CVE phase** — new `⚠ No patch available` phase in the safe update table for packages with active CVEs but no known patched version
- **Unpatched version status** — new `∼ Unpinned` badge logic improved to show latest available version even for non-exact specifiers when a registry version is known

### Fixed
- Gradle BOM resolution — `platform()` and `org.springframework.boot` plugin detected and resolved via `repo1.maven.org`
- Maven parent BOM resolution — `parsePomXmlAsync()` detects `spring-boot-starter-parent` and downloads `spring-boot-dependencies`
- Maven: no downgrade — if `installedVersion > latestVersion`, package is marked as `upToDate`
- Maven: pre-release filter — milestones (`-M1`), RC, alpha, beta, early access (`-ea`) and build metadata (`+`) filtered from `latestVersion`
- Maven: not found upToDate — when registry returns no result and version is exact, `upToDate: true`
- Node: false positive `>= 16` — `normalizeAndParts()` correctly groups operator and version separated by space
- Node: lockfile resolution in monorepos — `nodetools` accepts `packageDir`, looks for lockfiles in the `package.json` folder
- Monorepo support — recursive `fs.readdirSync` walk with `MAX_DEPTH=5` and complete `EXCLUDE_DIRS`
- `onStartupFinished` activation — works in any workspace regardless of files in root
- `$(sync~spin)` badge — progress badge shown immediately while scanning
- `scanInProgress` flag — prevents simultaneous scans

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
- **Ruby support** — scans `Gemfile` via RubyGems API + OSV.dev (ecosystem: RubyGems)
- **Go transitive conflict detection** — `go mod graph` support (Pro)

## [2.2.1] - 2026-05-04

### Added
- **Compatibility analysis for Node.js, Rust and Go**
- **Major version badge** — `⚠ Major` / `⚠ +N major` (Pro only)
- **Phased safe update table** — three phases by migration risk (Pro only)
- **Unit tests** — 68 tests across 5 files (Vitest)

## [2.2.0] - 2026-05-01

### Added
- **Rust support** — scans `Cargo.toml` via crates.io API + OSV.dev
- **Go support** — scans `go.mod` via Go module proxy + OSV.dev

## [2.1.2] - 2026-05-01

### Fixed
- Panel subtitle now shows dynamically which files are being scanned
