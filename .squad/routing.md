# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture and scope | Lead | Project structure, component boundaries, technical decisions, cross-layer contracts |
| React frontend | Frontend | Components, screens, client state, accessibility, responsive behavior |
| Node.js backend | Backend | API routes, server logic, persistence, validation, error handling |
| Testing and quality | Tester | Test strategy, unit/integration/E2E coverage, regression checks, review |
| Tooling and delivery | Infra | Package scripts, local setup, CI, environment templates, deployment |
| RAI and privacy | Rai | Credential checks, injection risks, privacy, accessibility and content concerns |
| Verification and assumptions | Fact Checker | Package/API claims, references, existence checks, pre-mortems |
| Memory and decisions | Scribe | Session logs, decision merging, cross-agent context |
| Work queue monitoring | Ralph | Backlog scans, issue monitoring, follow-up work |

Preset installation adds concrete routes for the configured team. Add or edit rows
here only when their agent names also exist in the casting registry.

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the Tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
