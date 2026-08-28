# Project Context

- **Owner:** Bernardo Mesko
- **Project:** sample-todo-app
- **Stack:** React, Node.js
- **Description:** A sample todo app with a React client and Node.js server.
- **Created:** 2026-08-27T14:29:49.064-03:00

## Learnings

Team initialized. Lead owns project structure, cross-layer contracts, scope, and technical decisions.

📌 Team update (2026-08-27T15:23:30.996-03:00): The cross-layer todo contract is now defined: UUID-backed `GET/POST /api/todos`, partial `PATCH /api/todos/:id`, `DELETE /api/todos/:id` with `{todos}`/`{todo}` envelopes and 204 success — decided by Backend.

📌 Review update (2026-08-27T15:23:30.996-03:00): Independently revised `server/test/app.test.js` and `README.md` after Tester identified missing partial-PATCH, documented failure-path, and test-isolation coverage; Tester approved the revision with server tests 18/18 and no high-confidence regressions.

📌 Wave update (2026-08-27T16:32:08.561-03:00): Independently fixed retry/list-refresh invalidation and title-length contract issues, then approved the revised implementation.

📌 Wave update (2026-08-27T17:15:15.088-03:00): Independently revised the Windows process cleanup to preserve descendant PIDs; Tester re-reviewed and APPROVED the Lead revision. `npm run validate` passed with the client build and 18 server tests; the POSIX path was not exercised.
