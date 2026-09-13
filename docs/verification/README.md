# Verification record

Verified September 13–14, 2026 (local timezone Asia/Kolkata; JSON timestamps use UTC).

- `npm run check`: lint, typecheck, 27 unit/API tests, and production build passed.
- `npm run test:e2e`: 10 tests passed across desktop and mobile Chromium. Covers landing entry, repository selection and rename, offline analysis, paths and ripple, mobile width, inventory, export, persistence, and invalid repository input.
- `live-repositories.json`: seven real public GitHub repositories. Each record contains the exact analyzed commit, selected projects, coverage, advisories, and warnings. npm/cli discovered 478 projects from 575 dependency files; one selected project was analyzed. The report does not claim all 478 were analyzed.
- `controlled-demo.json`: npm-generated workspace lockfile checked against live vulnerability sources; 53 versions checked, eight packages with findings, three application paths for top-ranked axios.
- `live-browser.json`: real GitHub URL submitted through the browser, Repository Map confirmed, analysis completed, OSV source link verified, and ripple traced to two of six projects. No JavaScript errors or page-width overflow. This run selected all six projects; the API matrix selected five.

Visual review covered desktop results, Repository Map, and mobile ripple. The observed mobile grid overflow was corrected and the full browser suite passed afterward. Screenshots and browser traces are local ignored artifacts in `test-results/`.

Live source contents may change. Python conditional relationships, manifest-only npm ranges, and Maven BOM resolution were explicitly partial in the tested inputs. No “secure” conclusion is inferred from an empty finding set or unavailable source.
