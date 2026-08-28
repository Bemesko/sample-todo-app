# Fact Checker Audit Trail

> Append-only evidence log. Entries are succinct — verdict + citation, never raw source material.

<!-- Fact Checker appends findings below -->

### 2026-08-27: Todo workflow contract verification
- ✅ README structure, workspace scripts, local ports, API routes, status codes, envelopes, in-memory storage, 204 handling, and validation command match source; `npm run validate` passed (18 API tests).
- ❌ README's “200 characters” claim is broader than the implementation: server and client count JavaScript UTF-16 code units (`String.length`/`maxLength`), so 101 emoji are rejected despite being 101 Unicode characters.
- ⚠️ “Empty update body” is ambiguous: `{}` returns `VALIDATION_ERROR`, while absent/blank bytes return `INVALID_JSON` (both 400).
- ⚠️ “Missing todos return 404” needs scope clarification: an unsupported `GET /api/todos/:id` returns 405 before todo existence is checked.
- ✅ UUID generation is backed by `crypto.randomUUID()`; the current test regex is weaker than canonical UUID validation but does not contradict runtime behavior.

### 2026-08-27: Todo workflow re-verification
- ✅ README now accurately states the 200 UTF-16 code-unit limit; source, client behavior, tests, and targeted Unicode probes agree.
- ✅ No remaining high-confidence contradictions found in documented endpoints, statuses, envelopes, validation rules, UUID generation, 204 handling, or client API handling; `npm run validate` passed again.
- ⚠️ Prior advisory ambiguities remain: only `{}` is a validation error for an empty update; absent/blank bytes are `INVALID_JSON`, and unsupported item methods return 405 before missing-item checks.
