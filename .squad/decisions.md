# Squad Decisions

## Active Decisions

### 2026-08-27T16:08:42.639-03:00: Dependency-light todo foundation and resilient workflow (consolidated)
**By:** Lead, Backend, Frontend, Tester, Infra, Rai, Fact Checker
**What:** Use npm workspaces with a `client/` React/Vite application and a dependency-light, framework-free `server/` Node.js HTTP API. Proxy `/api` from Vite during development and use same-origin fetches from the client. Keep state in an in-memory map with no database or `localStorage`; restart data loss is accepted. Preserve the settled contract: `GET /api/todos`, `POST /api/todos`, `PATCH /api/todos/:id`, and `DELETE /api/todos/:id`; UUID string IDs; `title` and `completed` fields; partial PATCH updates; `{ todo }` and `{ todos }` envelopes; and the established statuses, including successful `204 No Content` deletes handled without JSON parsing. The React UI implements list, create, toggle, edit, and delete with pessimistic mutations, explicit loading/empty/success/failure states, retryable network errors, field-level validation accepting trimmed titles up to 200 characters, per-todo mutation serialization, stale-list protection, reconciliation after mutation 404, semantic accessible controls, keyboard focus, visible focus styles, live status/error regions, escaped text, and responsive styling. Keep the health endpoint, server smoke coverage, per-`createApp` isolation, and contract tests; defer ordering, filtering, pagination, multi-tab/versioning, and production persistence/serving.
**Why:** The original foundation keeps the client/server boundary and local development workflow dependency-light, while the settled API gives the client stable resource and error shapes without coupling it to a database. Pessimistic, serialized, race-aware mutations and reconciliation make UI transitions deterministic when requests overlap or todos disappear; explicit states and retryable failures make recovery visible. Validation, escaped text, semantic controls, focus handling, and live regions protect users and accessibility. Isolated contract coverage keeps tests reliable without expanding persistence.

### 2026-08-27: Keep todo synchronization in an API wrapper and hook
**By:** Frontend
**What:** Centralize same-origin todo requests in `client/src/todoApi.js` and keep list loading, mutation queues, stale-response protection, and server-result application in `client/src/useTodos.js`.
**Why:** Components can focus on accessible workflow states and field-level feedback while one state model enforces pessimistic mutations, per-todo serialization, 204 handling, and 404 list reconciliation consistently.

### 2026-08-27: Keep todo client coverage dependency-free for this increment
**By:** Tester
**What:** Treat the existing Node `node:test` API suite as the automated quality gate for the todo contract. The client workspace has no test script, DOM environment, browser runner, or UI-testing dependency, so do not add a new testing dependency for this increment; review the React workflow with the acceptance checklist and targeted browser/manual fault injection instead.
**Why:** The repository already provides focused server integration coverage (18 passing tests), while the client currently has only React/Vite runtime dependencies. Preserving the dependency-light boundary avoids introducing an unrequested test stack and keeps the root `validate` command deterministic. Any future client harness should be an explicit team decision.

### 2026-08-27: Refresh mutation-invalidated list reads after queued work settles
**By:** Lead
**What:** Treat list responses started during an active mutation, or invalidated by a mutation that starts while the list request is active, as stale without changing list state. Track that a refresh is required and issue one follow-up list request after all queued mutations settle, including retries started from an error state; a successful 404 reconciliation may satisfy that refresh when no other mutation remains.
**Why:** A retry launched while a create or edit is pending cannot safely publish its response because it may predate the mutation. Deferring the state transition and reloading after the final mutation settles prevents both a permanent loading state after mutation failure and a stale success state, while preserving pessimistic serialized mutations and avoiding unnecessary reloads when no list request was overlapped.

### 2026-08-27: Document title limits using UTF-16 code units
**By:** Lead
**What:** Define the documented 200-unit title limit in terms of UTF-16 code units, matching the existing JavaScript `String.length` validation in both client and server.
**Why:** JavaScript counts astral Unicode characters such as emoji as two UTF-16 code units. The README's former “200 characters” wording implied Unicode code-point counting and contradicted the implementation for titles containing those characters; no product requirement justifies changing the established validation behavior.

### 2026-08-27: Use PID-scoped process-tree cleanup for local development
**By:** Infra
**What:** Launch workspace npm commands through the Node npm CLI without `shell: true`; terminate each spawned tree with `taskkill /T /F` on Windows and a detached process group on POSIX.
**Why:** Windows shell children otherwise outlive `scripts/dev.mjs`, leaving the client and API ports occupied. PID-scoped tree termination fixes cleanup without broad name-based process kills while preserving the existing workspace commands.

### 2026-08-27T16:44:41-03:00: Preserve Windows descendants for late cleanup
**By:** Lead
**What:** On Windows, cache descendant PIDs through targeted parent-process queries while each npm wrapper runs, then invoke `taskkill /PID ... /T /F` for the cached identifiers even after the wrapper reports an exit code. Keep the existing POSIX process-group path and avoid shell or name-based termination.
**Why:** `taskkill /T` cannot reliably traverse a wrapper that has already exited, so late shutdown otherwise leaves Vite and esbuild alive. Retaining their observed PIDs closes that race without broad process termination.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
