# Project Context

- **Owner:** Bernardo Mesko
- **Project:** sample-todo-app
- **Stack:** React, Node.js
- **Description:** A sample todo app with a React client and Node.js server.
- **Created:** 2026-08-27T14:29:49.064-03:00

## Learnings

Team initialized. Frontend owns the React experience, client state, accessibility, and UI integration.

📌 Team update (2026-08-27T14:55:31.498-03:00): Build UI work in the `client/` React/Vite app and use the proxied `/api` boundary; server framework and database choices remain deferred — decided by Lead.

📌 Team update (2026-08-27T15:23:30.996-03:00): Consume the todo API at `GET/POST /api/todos` and `PATCH/DELETE /api/todos/:id`; use UUID IDs, `{todos}`/`{todo}` envelopes, `title`/`completed` fields, partial PATCH updates, stable validation errors, and 204 deletes — decided by Backend.

📌 Team update (2026-08-27T16:17:35.778-03:00): Keep same-origin todo requests in `client/src/todoApi.js`; keep loading, per-todo mutation queues, stale-response protection, and server-result application in `client/src/useTodos.js` — decided by Frontend.

📌 Wave update (2026-08-27T16:32:08.561-03:00): Implemented the React todo workflow in `client/src/`, including API/state modules, CRUD/toggle/edit flows, race and error handling, accessible states, and responsive styling; review status is recorded in the implementation-wave log.
