# RAI Audit Trail

> Append-only evidence log. Entries are redacted — never contains raw secrets or harmful content.

<!-- Rai appends findings below -->

### 2026-08-27: Todo workflow RAI review
- **Files/lines:** `server/src/app.js:277-293,336-338`; `README.md:14-16`
- **Category/severity:** Privacy and data isolation — advisory
- **Finding:** In-memory todos are process-wide and `GET /api/todos` returns the complete collection without authentication, authorization, or user scoping.
- **Remediation:** Open — restrict deployment to trusted single-user/local use or add identity-aware storage and authorization; document the privacy and retention boundary.

- **Files/lines:** `server/src/app.js:4-5,277-293`
- **Category/severity:** Security posture — advisory
- **Finding:** Mutation endpoints have per-request size/title limits but no rate limit or collection bound, allowing a public caller to generate unbounded in-memory state.
- **Remediation:** Open — add per-user/IP throttling and a total collection/resource limit, or keep the service explicitly local-only.

- **Files/lines:** `client/src/App.jsx:174-185,212-235,250-267`
- **Category/severity:** Accessibility — advisory
- **Finding:** Entering edit mode focuses the edit field, but save/cancel and deletion do not restore or relocate focus when controls/rows unmount.
- **Remediation:** Open — return focus to the invoking action after save/cancel and move it to a deterministic surviving control after deletion.

- **Files/lines:** `client/src/styles.css:44-47,163-165,334-337,376-379`
- **Category/severity:** Accessibility/contrast — advisory
- **Finding:** The focus outline, placeholder, completed-title, and busy-row muted text colors can fall below common WCAG contrast targets.
- **Remediation:** Open — select focus and text colors that meet the applicable contrast ratios without relying on row opacity.

- **Files/lines:** `client/src/App.jsx:488-490`; `README.md:14-16`
- **Category/severity:** Transparency/privacy — advisory
- **Finding:** The UI says changes sync automatically but does not state that the server keeps them only in memory and clears them on restart.
- **Remediation:** Open — disclose the local/in-memory retention behavior in the UI or provide durable storage with an explicit retention policy.
