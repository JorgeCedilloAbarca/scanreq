# Changelog

All notable changes to ScanReq will be documented in this file.

## [2.6.3] - 2026-05-26

### Fixed
- **Python conflict detection was 100% broken** — the regex used to parse `requires_dist` strings from PyPI had double backslashes (`\\s`, `\\(`, `\\)`) in a regex literal, which means literal `\s`, `\(`, `\)` instead of whitespace and parens. Result: `depMatch` was always `null` and the function skipped every transitive dependency without analyzing it. The "Cross-version compatibility analysis" feature advertised for the Pro plan never reported a single Python conflict. Fixed with single backslashes.
- **Spring Boot plugin not detected in Kotlin DSL `build.gradle.kts`** — the regex for the implicit `spring-boot-dependencies` BOM matched only Groovy DSL (`id 'org.springframework.boot' version '2.7.18'`) but not Kotlin DSL (`id("org.springframework.boot") version "3.2.1"`). The character class contained an unescaped triple-quote and the closing parenthesis wasn't allowed before `version`. Result: all Kotlin Gradle projects with Spring Boot resolved zero BOM-managed dependencies as version `unknown`. Rewritten to accept both DSLs with optional parentheses.
- **`compareVersions` treated pre-releases as greater than the final release** — the implementation used `replace(/[^0-9.]/g, '')` which turned `1.0.0-rc1` into `1.0.01` and treated it as `[1,0,0,1]` — numerically *greater* than `[1,0,0]`. By semver, pre-releases must be *less* than the corresponding final. Affects: sorting of `fixedVersions` from OSV (could recommend `2.0.0-rc1` over the stable `2.0.0`), all version comparisons across ecosystems. Reimplemented to split version into core + pre-release components per semver rules.
- **Node x-ranges `16.x`, `16.x.x` silently considered as satisfied** — `parseSemverRange` returned `null` for x-range specifiers (common in peerDependencies). The `checkSatisfied` function then treated `null` as "no spec to check" and returned `true`, hiding real conflicts. A React 17 project with a peerDep of `16.x` would not be flagged. Added explicit `evaluateXRange()` that resolves x-range specs against the installed major (and minor when present).
- **`create-checkout` Worker had no rate limit** — every other Worker uses KV-backed rate limiting except this one. An attacker could create thousands of Stripe checkout sessions, consuming Stripe API quota and potentially flagging the account for abuse. Added 5 checkouts per IP per hour with the same KV pattern as the other Workers.
- **`create-checkout` accepted any string as `currency`** — the worker did `PRICE_IDS[currency] ?? PRICE_IDS.usd`, silently falling back to USD when receiving unexpected values. Now validates against a closed set `{'usd', 'eur'}` and returns 500 if the corresponding PRICE_ID env var is missing instead of silently charging USD.
- **`success.html` retry button left the error card visible on success** — if the user clicked "Try again" and the second request succeeded, the red error card stayed visible above the token. Now hidden when the retry returns a valid token.
- **`Gemfile.lock` parser docstring described the wrong indentation** — comments stated "top-level: 6 spaces, subdependencies: 8+" but Bundler 2.x uses 4 spaces for top-level and 6 for subdeps. The code was correct (regex `^ {4}(?! )` already filters properly) but the misleading docstring made future maintenance error-prone. Docstring corrected.
- **`validate-license` discarded errors from the `activated_at` UPDATE** — the UPDATE that registers first activation didn't check its result. If the column was missing or the service role lacked permissions, the activation timestamp was silently dropped. Now logs the error via `console.error` to make schema issues visible in Worker logs.
- **`stripe-webhook` lost the purchase email on transient Resend failures** — a single Resend timeout left the token stored but the email never sent; the user had to manually use `/recover` to get their token. Added a single retry with a 1.5s delay before giving up. If both attempts fail, the user can still recover via `scanreq.com/recover` as before.

### Changed
- **`netlify.toml` reduced to publish-only** — the file declared redirects from `/api/*` to `/.netlify/functions` and listed legacy serverless functions that no longer exist on the live deployment (everything is on Cloudflare Workers now). If anyone re-enabled Netlify deploy by accident, the old functions would re-activate without the latest security fixes. Now contains only `[build] publish = "."` so a Netlify deploy serves only the static site and the obsolete functions cannot be reached.

### Refactored
- **`versionToTuple` in `python/compatibility.ts` was a duplicate** — the function had been left behind during the D2 refactor that moved version utilities to `shared.ts`. Removed and replaced with an import from `shared.ts`.

## [2.6.2] - 2026-05-25

### Security
- **OSV failures no longer shown as "✓ No CVEs"** — when OSV returns a timeout, 429, or 5xx, the result is now shown as `⚠ CVE Error` (distinct red badge) instead of the green "No CVEs" badge. A warning insight appears at the bottom of the panel. The status bar also reflects the incomplete check state. Previously, an OSV failure was indistinguishable from a confirmed clean result — a silent false-negative in a security tool.
- **`notify` endpoint: CORS restricted + rate limiting** — `/api/notify` (waitlist) previously accepted requests from any origin (`*`) with no rate limit. Now restricted to `scanreq.com` origins and limited to 5 requests per IP per hour via Cloudflare KV.
- **`recover-token` endpoint: CORS restricted + rate limiting + timing oracle fix** — `/api/recover-token` previously accepted `*` CORS, had no rate limit, and was vulnerable to a timing side-channel (email-exists paths were slower due to the Resend call). Now restricted to `scanreq.com`, limited to 3 requests per IP per hour, and a random 500–1500ms delay equalizes response times.
- **Token generator uses `crypto.getRandomValues()`** — `generateToken()` in the Stripe webhook used `Math.random()`, which is not cryptographically secure. Replaced with `crypto.getRandomValues()`, available natively in Cloudflare Workers.
- **`get-token` endpoint: session_id format validation** — the `session_id` parameter is now validated against the Stripe format (`cs_test_` / `cs_live_`) before querying Supabase. Previously any string would trigger up to 5 Supabase queries (10s of retries).
- **`validate-license` no longer returns customer email** — the response previously included `email: data.customer_email`, which the plugin does not use. A leaked token would also expose the buyer's email. Removed.

### Fixed
- **Python: compound version specifiers showed garbage as installed version** — `>=1.0,<2.0` was parsed and the version field was set to `1.0,<2.0` (the raw specifier with only the first operator stripped). The UI showed this string as the installed version. Now correctly extracts only the first numeric version component (`1.0`).
- **PHP: single-pipe OR operator not recognized in compatibility** — Composer supports both `||` and `|` as OR operators (e.g. `^6.0|^7.0`). Only `||` and ` | ` (with spaces) were handled; `^6.0|^7.0` was passed unsplit to the spec parser, which fell back to `return true`, silently hiding real conflicts.
- **Watcher fires multiple scans on `npm install`** — the file watcher had no debounce. Running `npm install` modifies `package.json`, `package-lock.json`, and many files in sequence, triggering multiple concurrent scans. Added a 2-second debounce so only one scan fires after activity settles.

### Changed
- **License and activation messages fully internationalized** — all user-facing strings in `license.ts` and the `deactivateLicense` command were hardcoded in Spanish, breaking the experience for English VS Code users. All messages now route through the `i18n` system with English and Spanish variants.
- **Command palette titles updated to English** — `ScanReq: Activar Plan Pro` and `ScanReq: Desactivar Plan Pro` renamed to `ScanReq: Activate Pro Plan` and `ScanReq: Deactivate Pro Plan` for consistency with VS Code conventions. The scan command retains both languages (`Analizar dependencias / Scan dependencies`).
- **`revalidateLicenseIfNeeded` comment corrected** — the comment said "every 7 days" but the interval was already 24 hours since v2.5.1. Comment updated.
- **`success.html` activation step corrected** — the "How to activate" instructions showed the Spanish command `ScanReq: Activar Plan Pro`. Corrected to `ScanReq: Activate Pro Plan`.
- **`success.html` retry button on token not found** — if the token isn't available yet (Stripe webhook still processing), the error card now shows a "↻ Try again" button instead of only a static message.
- **`index.html` version badge updated** — hero badge updated from `v2.5` to `v2.6`.

### Refactored
- **`safeUpdates` logic extracted to `shared.ts`** — the 40-line block that builds safe update recommendations (including CVE-patched version handling) was duplicated across 6 compatibility files. Extracted to `buildSafeUpdate()` and `buildAllSafeUpdates()` in `src/ecosystems/shared.ts`. Bug fixes now apply to all ecosystems at once.
- **`compareVersions` extracted to `shared.ts`** — version comparison utilities were duplicated in 8+ files. Consolidated into a single implementation.
- **`clearBomCache()` added to Java and Gradle parsers** — the BOM download cache was never cleared between scans. If the user updated their Spring Boot version and the watcher triggered a rescan, the old BOM was still in memory. Both adapters now clear the cache at scan start.
- **`clearPipCache()` and `clearGoCache()` added** — tool availability caches for pip and Go were permanent for the VS Code session. If the user installed either tool after opening VS Code, ScanReq wouldn't detect it until restart. Adapters now clear these caches at scan start.

## [2.6.1] - 2026-05-22

### Fixed
- **Activar Pro button broken in webview** — the button used `href='command:scanreq.activateLicense'` which is silently blocked by the strict CSP. Fixed using `acquireVsCodeApi().postMessage` in the webview and `onDidReceiveMessage` in the panel.
- **Ruby: Gemfile.lock lockfile ignored in modern Bundler** — regex accepted only 4 or 8 spaces indentation. Bundler >= 2.4 uses 6-space indentation for top-level gems, causing all lockfile versions to be silently ignored. Fixed to accept 4–6 spaces.
- **Java/Gradle: BOM download could hang scan indefinitely** — `resolveBomVersions()` had no timeout when downloading Spring Boot BOM from Maven Central. Added 10s `AbortController` timeout.
- **Node.js: lockfile cache race condition in monorepos** — a single global cache variable caused parallel scans of multiple `package.json` files to overwrite each other's lockfile data. Replaced with a per-directory `Map`.
- **Python: PyPI fetch had no timeout** — a slow PyPI endpoint could hang the Python scan indefinitely. Added 10s `AbortController` timeout.
- **All registries: fetch timeouts added** — Node.js (npm), Rust (crates.io), PHP (Packagist), Ruby (RubyGems), and Java (Maven Central, 3 endpoints) had no timeout on their registry fetch calls. All now abort after 10s.
- **Go: private/unindexed modules now distinguished from errors** — a 404 or 410 from the Go module proxy (private or unlisted module) now shows `Private / not indexed` and `upToDate: true` instead of `Not found` and a false outdated warning.
- **Go: explicit isPro guard on CVE check** — added consistent guard matching all other ecosystems. No functional change since Go always has exact versions, but prevents future regressions.
- **Java: hardcoded Spanish strings** — `'Versión dinámica'`, `'Repositorio privado'`, `'No disponible'` replaced with English equivalents for consistency with non-Spanish VS Code installs.
- **Java: `upToDate` now uses `compareSemver`** — strict `===` comparison failed for versions with differing suffix capitalisation (e.g. `3.2.1-Final` vs `3.2.1-final`), causing false outdated warnings.

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
