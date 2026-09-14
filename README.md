# RootLine

Understand a repository, check its dependencies, and trace how a package connects to applications. The existing React/Fastify app now follows **Scan → Repository Map → Analyze → Priority → Trace Ripple**.

## Run locally

Requires Node.js 24 or newer. From this directory:

```sh
npm ci
npm run local
```

Open http://127.0.0.1:3000/app#new. Public GitHub scans need internet access; **Explore demo** works offline. No API key is required for public scans. Optional configuration is documented in `.env.example`. SQLite snapshots and source caches persist under `data/`. Keep the default loopback binding for local use; production requires an API token.

## Two-minute recording

1. **0:00–0:20:** Open **Explore demo** from the landing page. Say that this is the clearly labeled offline illustrative scenario.
2. **0:20–0:40:** Show the four projects in Repository Map. Rename Storefront if desired, leave all four selected, and click **Analyze repository**.
3. **0:40–1:00:** Point to lodash, its installed version, and the reasons for its priority: severity, source-reported exploitation, depth, and three affected projects.
4. **1:00–1:35:** Click **Trace Ripple**. Follow the package paths back to the three affected applications; show the four paths and unaffected fourth project.
5. **1:35–2:00:** Open the package details and explain how it entered the applications. Clarify that dependency paths describe possible impact, not proof that vulnerable code executes.

For a recording using real source-backed findings, publish the prepared [controlled repository](demo-repository/README.md), paste its GitHub URL, and select the three `apps/` projects. Live verification found axios connected to all three through the shared package. Advisory counts and rankings can change as security sources update. The offline demo remains the reliable backup.

## OTTER

OTTER is RootLine's built-in explanation and navigation assistant. It is available from every analysis section once a scan completes, and opens as a side panel (a bottom sheet on phones) without leaving the current screen.

- **Groq, server-side only.** Set `GROQ_API_KEY` in `.env`. The browser only talks to RootLine; the key is never sent to the client. Without a key OTTER shows that it is not configured and the rest of RootLine is unaffected.
- **Grounded in RootLine facts.** The server builds a small context from the stored scan for the current page (or for one finding) and instructs the model to use only those facts. Replies that name an advisory ID absent from that context are withheld, and navigation actions are validated against real sections and entities.
- **Focused vulnerability conversations.** Vulnerabilities → **View brief** → **Ask OTTER about this vulnerability** opens a separate conversation that only receives that finding's facts. Questions about other findings are declined in that branch; the global conversation is kept.
- **Answer modes.** Auto (default), Fast and Deep map to Groq models currently available to the key (`openai/gpt-oss-120b` / `openai/gpt-oss-20b`, with fallbacks).
- **Voice input.** The microphone records a short clip, the server transcribes it with Groq Whisper, and the text lands in the input for editing. Permission, recording and transcription failures are reported as errors; nothing is invented. There is no image or camera input.

Conversations live in the browser tab's session storage per scan. OTTER cannot change code, findings or dependencies.

## Accuracy and limits

| Input | What is reconstructed |
| --- | --- |
| npm package-lock/shrinkwrap v2/v3 | Installed paths, nearest dependency resolution, workspace links, direct/indirect depth, and runtime/development scope. Independent installations remain distinct. |
| npm older lockfiles | Supported by the existing parser; less workspace context than v2/v3. |
| pnpm locks | Importer dependencies and recorded snapshot relationships; unsupported local workspace links remain explicit warnings. |
| package.json without usable lock / Yarn | Exact manifest pins are checked; ranges and other declarations remain visible as unresolved. Yarn lock resolution is not implemented. |
| Python requirements / Pipfile.lock | Exact pins are checked; unpinned declarations are retained with their constraints. Flat files do not establish indirect ancestry. Includes and commands are not executed. |
| uv / Poetry locks | Recorded packages and reconstructable edges; environment selection and application membership may remain unknown. Root links labeled “listed” do not establish direct depth. |
| Maven dependency tree | Recorded resolved dependency relationships. |
| Maven pom.xml | Literal versions only; parent properties, BOM-managed versions, profiles, and indirect dependencies may be unresolved. Maven is never executed. |

Related files are grouped by path and ecosystem. Repository Map reads declarations and reports detected, exact and unresolved counts before analysis. Project coverage is EXACT, PARTIAL, DECLARED_ONLY or UNSUPPORTED. Unresolved nodes retain an unversioned identity, their declared specifier and partial coverage; they are not vulnerability-checked or priority-scored. Repository discovery has no manifest-count cutoff. Truncated GitHub trees use bounded directory traversal and disclose remaining gaps. File/transport limits, unsupported formats, and individual parser failures produce project-level coverage notes; they do not turn unchecked packages into safe ones.

OSV provides package/version findings; CVSS vectors are scored deterministically. Registry sources can supplement findings; NVD enriches already-mapped CVEs only. CISA KEV adds positive known-exploitation evidence by exact CVE. Missing signals remain unknown. Fixed versions come only from matching affected-package evidence. No exploitation probability is invented.

Ripple Priority is a bounded triage score, not a probability: severity up to 60 (CVSS × 6), source-reported exploitation 15, exposure up to 10 (inverse known depth, halved for development-only usage), and repository impact up to 15 (12 for affected-project proportion plus 3 for ancestor proportion). Findings rank ahead of packages without findings. Source facts, factors, and paths remain inspectable. Depth describes the recorded graph, not code execution.

All occurrences of a selected package version are considered for impact, while installed-instance edges prevent false cross-project paths. Reverse traversal is cycle-safe. Path enumeration is bounded and labeled “at least” when truncated. The focused graph displays up to 70 nodes; the complete retained inventory and export remain available. Checking defaults to 2,000 unique package versions, configurable within bounds; omitted or failed checks remain visibly partial.

The built-in demo contains synthetic `DEMO-*` security data and illustrative edges. The prepared real demo uses an npm-generated lockfile and live source findings. Neither is a production certification.

## Verification

```sh
npm run check
npm run test:e2e
# Start the app first for the live repository matrix:
node --import tsx scripts/verify-real-repos.ts
node --import tsx scripts/verify-controlled-demo.ts
node --import tsx scripts/verify-live-browser.ts
VERIFY_BROWSER=1 node --import tsx scripts/verify-ingestion.ts
```

Browser tests require Playwright Chromium (`npx playwright install chromium`), or set `PW_CHROME=1` to use installed Chrome. Tests use a separate local server and database on port 3100, plus a local mock Groq server on port 3101 so OTTER tests never call the real API.

Recorded results: [public repository matrix](docs/verification/live-repositories.json), [controlled demo evidence](docs/verification/controlled-demo.json). These are dated observations, not assertions about future repository contents or vulnerability-source responses.

The matrix covers expressjs/express (small npm), this repository (lockfile), npm/cli (478 projects / 575 files), pallets/flask (Python), spring-projects/spring-petclinic (Maven), GoogleCloudPlatform/microservices-demo (mixed language), and octocat/Hello-World (empty supported-manifest state). Coverage warnings are preserved in the report.

Main implementation: `src/server/discovery.ts`, `resolve-project.ts`, `advisories.ts`, `connectors.ts`, `jobs.ts`, and `graph.ts`; OTTER in `src/server/otter/` and `src/web/otter/`; shared types and scan facts in `src/shared/`; workspace sections in `src/web/workspace/`. Existing authenticated APIs, export, and webhook boundaries remain in place without expanding enterprise features.
