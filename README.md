# Sample Todo App

A small full-stack todo app foundation with a React client and a Node.js API.

## Structure

- `client/` — React UI built by Vite and served by the production Node process.
- `server/` — Node.js HTTP API with no database or web framework yet.
- `scripts/dev.mjs` — starts the client and server together from one command.

The Vite development server proxies `/api` requests to the Node server on
`http://localhost:3001`.

## Todo API

The API keeps todo state in memory, so restarting the server clears all todos.
Todo IDs are opaque UUID strings. A todo has this shape:

```json
{
  "id": "2c4d6f21-9f5a-4db8-a1c2-6d4e68b4e73a",
  "title": "Buy milk",
  "completed": false
}
```

### Endpoints

| Method and path | Request body | Success response |
| --- | --- | --- |
| `GET /api/health` | None | `200 { "status": "ok" }` |
| `GET /api/todos` | None | `200 { "todos": [todo, ...] }` |
| `POST /api/todos` | `{ "title": "Buy milk" }` | `201 { "todo": todo }` |
| `PATCH /api/todos/:id` | One or both of `title` and `completed`; omitted fields remain unchanged | `200 { "todo": todo }` |
| `DELETE /api/todos/:id` | None | `204` with an empty body |

Create and update requests must use `Content-Type: application/json`.
Titles must be strings whose trimmed value is non-blank and at most 200 UTF-16
code units long. Create requests accept only `title`; new todos always start with
`completed: false`. Update requests accept only `title` and `completed`, must
include at least one field, and require `completed` to be a boolean.
The title limit is inclusive: 200 UTF-16 code units are accepted, while 201
are rejected. Unknown fields and an empty update body are validation errors.

### Errors and status codes

Errors always use this JSON envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body failed validation.",
    "details": [
      { "field": "title", "message": "Title must not be blank." }
    ]
  }
}
```

`details` is included for validation errors and omitted when there are no
field-level details. Malformed JSON and validation failures return `400`.
Unsupported media types return `415`, oversized request bodies return `413`,
missing routes or todos return `404`, and unsupported methods return `405`
with an `Allow` header. Deleting a missing todo is also `404`.

## Run locally

Requires Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer. These are the
versions supported by the Vite release used by the client workspace.

```sh
npm install
npm run dev
```

The client is available at `http://localhost:5173`. To run either side
separately, use `npm run dev:client` or `npm run dev:server`.

## Validation

```sh
npm run validate
```

This builds the client and runs the server API tests.

## Container image

The root `Dockerfile` builds the React client and serves it with the Node API
from one production image. It listens on port `3001` by default and honors the
`PORT` environment variable (use an unprivileged port when overriding it).
Its Docker `HEALTHCHECK` calls `GET /api/health` on the effective `PORT`.

```sh
docker build --tag sample-todo-app .
docker run --rm --publish 3001:3001 sample-todo-app
```

The container keeps todo state in memory, so restarting or replacing it clears
the list.

## Runtime telemetry

The server emits one JSON line to `stdout` after every HTTP response:

```json
{
  "event": "http.request",
  "requestId": "2c4d6f21-9f5a-4db8-a1c2-6d4e68b4e73a",
  "method": "GET",
  "pathname": "/api/health",
  "status": 200,
  "durationMs": 2
}
```

The server-generated `requestId` is also returned in the `x-request-id`
response header. Telemetry contains only the method, URL pathname (never the
query string), status, duration, and request ID; it does not log request bodies,
credentials, or client data. Azure Container Apps captures `stdout` and
`stderr` in the existing Log Analytics destination. JSON is stored as text in
the `Log_s` column of `ContainerAppConsoleLogs_CL`, so parse it when querying:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == '<container-app-name>'
| extend telemetry = parse_json(Log_s)
| where tostring(telemetry.event) == 'http.request'
| project TimeGenerated,
    RequestId=tostring(telemetry.requestId),
    Method=tostring(telemetry.method),
    Path=tostring(telemetry.pathname),
    Status=toint(telemetry.status),
    DurationMs=toint(telemetry.durationMs)
| order by TimeGenerated desc
| take 100
```

## Deploying to Azure Container Apps

The local deployment runner provisions the app in subscription
`571400a1-1f0a-4d1f-9003-1bd19a468181`, resource group `azsampletodo`, and region
`brazilsouth`. It does not use GitHub Actions or registry passwords.

### Prerequisites

- Node.js 20 or newer and npm
- Docker Desktop running
- Azure CLI 2.77 or newer with the built-in Bicep integration
- PowerShell 5.1 or newer
- An Azure login with permission to deploy resources and create the `AcrPull`
  role assignment

Sign in and select the approved subscription:

```powershell
az login
az account set --subscription 571400a1-1f0a-4d1f-9003-1bd19a468181
```

Run the idempotent local build, validation, what-if, provision, push, deploy,
and verification workflow:

```powershell
.\infra\deploy.ps1 -ResourceToken todo
```

The runner builds the existing `Dockerfile`, starts the image locally to check
`/api/health` and the UI, creates or updates the platform, logs in with
`az acr login`, pushes an immutable `sha-<image-id>` tag, reads the resulting
content digest, and deploys the digest-qualified image reference
(`registry/repository@sha256:<digest>`). It runs `what-if` before both the
subscription and resource-group deployments. A bounded HTTPS retry then checks
the public root, health endpoint, and `POST`/`GET`/`PATCH`/`DELETE` todo flow.

The generated resources are:

- Private/authenticated Azure Container Registry (Basic SKU; anonymous pulls
  and admin credentials disabled)
- Log Analytics workspace connected to the Container Apps environment
- User-assigned managed identity with `AcrPull` scoped only to the registry
- Consumption-based Container Apps managed environment
- One public Container App with HTTPS ingress on port `3001`, single revision,
  health probes, explicit CORS, and conservative CPU/memory limits
- Enabled Azure Monitor log alert for HTTP 5xx responses, with an optional
  operator-provided action group

The workload intentionally uses `minReplicas: 0` and `maxReplicas: 1` for this
sample. This is not highly available: scale-to-zero introduces cold starts, and
multiple replicas would diverge because todo state is in memory. Do not increase
`maxReplicas` until persistence and coordination are added. Set `minReplicas`
to at least `1` in the workload template only when an always-on single replica
is required. The Docker health check and Container Apps startup, liveness, and
readiness probes all use `GET /api/health` on port `3001`.

The runner prints the resource IDs and provisioning states, registry image tag
and digest, Container App FQDN, public URL, and Azure portal resource-group URL.
To remove the deployed resource group after inspection:

```powershell
az group delete --name azsampletodo --subscription 571400a1-1f0a-4d1f-9003-1bd19a468181 --yes --no-wait
```

Todo data remains in memory in Azure, so replacing or restarting the Container
App clears the list.

## Publishing to Azure Container Registry

`.github/workflows/publish-container.yml` publishes
the `sample-todo-app` image on pushes to the default `main` branch and on manual
dispatches. A validation job runs `npm ci` and `npm run validate` before the
build-and-push job. Configure these repository Actions values before running it:

- `ACR_REGISTRY` — the registry login server, such as
  `azacr<token>.azurecr.io`, without an `https://` prefix.
- `ACR_USERNAME` — the non-secret username for a least-privilege principal
  allowed to push to that registry.
- `ACR_PASSWORD` — the corresponding secret for that principal.

The platform template disables ACR admin credentials and grants its managed
identity `AcrPull` only. An operator must therefore provision the CI principal
and grant it `AcrPush` at the registry scope; the workflow does not invent or
store those credentials. Every run pushes only a `sha-<full commit SHA>` tag,
returns the content digest as a job output, and uploads the immutable image
reference as an artifact. It never publishes or falls back to `latest`. For a
direct workload deployment, pass the registry name, repository name, and the
64-character digest (without the `sha256:` prefix) as separate parameters;
`infra/workload.bicep` constructs the resulting
`registry/repository@sha256:<digest>` reference. The publishing workflow is not
used by the local Azure deployment described above.

## Alerting

The platform template creates an enabled Azure Monitor scheduled-query log
alert scoped to the existing Log Analytics workspace. It filters the verified
`ContainerAppConsoleLogs_CL` table for the app's structured `http.request`
telemetry and alerts when an HTTP status is at least `500`:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == '<container-app-name>'
| extend telemetry = parse_json(Log_s)
| where tostring(telemetry.event) == 'http.request'
| where toint(tostring(telemetry.status)) >= 500
| summarize ErrorCount = count() by bin(TimeGenerated, 5m)
```

`alertActionGroupId` is optional and defaults to an empty value. The rule is
still created without notifications when it is omitted; no recipients or
action groups are invented. To attach an existing action group, pass its full
resource ID to the deployment runner:

```powershell
.\infra\deploy.ps1 -ResourceToken todo -AlertActionGroupId '/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Insights/actionGroups/<action-group-name>'
```

The custom console-log table can take time to appear after the environment
emits its first logs, so the template skips deployment-time query validation
after verifying the table and columns against the Container Apps schema. Query
the workspace after deployment and confirm that an action group is configured
if notifications are required.
