# Project Context

- **Owner:** Bernardo Mesko
- **Project:** sample-todo-app
- **Stack:** React, Node.js
- **Description:** A sample todo app with a React client and Node.js server.
- **Created:** 2026-08-27T14:29:49.064-03:00

## Learnings

Team initialized. Backend owns Node.js APIs, validation, persistence, and server-side behavior.

📌 Team update (2026-08-27T14:55:31.498-03:00): Build server work against the dependency-light Node.js HTTP API; keep framework and database choices deferred and preserve the Vite `/api` proxy boundary — decided by Lead.

📌 Review update (2026-08-27T15:23:30.996-03:00): Tester rejected the initial todo API pass for missing partial-PATCH, documented failure-path, and test-isolation coverage. Lead independently revised tests and README without changing `server/src/app.js`; Tester approved the revision after 18/18 server tests.
