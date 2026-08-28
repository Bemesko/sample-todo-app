# Project Context

- **Owner:** Bernardo Mesko
- **Project:** sample-todo-app
- **Stack:** React, Node.js
- **Description:** A sample todo app with a React client and Node.js server.
- **Created:** 2026-08-27T14:29:49.064-03:00

## Learnings

Team initialized. Tester owns behavior coverage, edge cases, regression checks, and quality review.

📌 Team update (2026-08-27T14:55:31.498-03:00): Validate the npm-workspace client/server boundary, Vite `/api` proxy, and server health contract without assuming a framework or database — decided by Lead.

📌 Team update (2026-08-27T15:23:30.996-03:00): Treat the UUID todo CRUD routes, `{todos}`/`{todo}` envelopes, validation errors, partial PATCH behavior, and 204 deletes as the canonical API contract for regression coverage — decided by Backend.

📌 Review update (2026-08-27T15:23:30.996-03:00): Re-reviewed Lead's independent test and README revision after rejecting the initial pass for partial-PATCH, documented failure-path, and test-isolation gaps. Approved with no high-confidence regressions; server tests passed 18/18.

📌 Team update (2026-08-27T16:17:35.778-03:00): Use the existing Node `node:test` API suite as the quality gate for this increment; keep client coverage dependency-free and review UI behavior with acceptance and manual fault-injection checks — decided by Tester.

📌 Wave update (2026-08-27T16:32:08.561-03:00): Rejected the initial todo implementation wave; the subsequent Lead fix and Fact Checker re-approval are recorded in the implementation-wave log.

📌 Wave update (2026-08-27T17:15:15.088-03:00): Re-reviewed Lead's independent process-cleanup revision after rejecting Infra's first cleanup and APPROVED the Lead revision. `npm run validate` passed with the client build and 18 server tests; the POSIX path was not exercised.
