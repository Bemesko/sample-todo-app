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

Requires Node.js 20 or newer.

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

```sh
docker build --tag sample-todo-app .
docker run --rm --publish 3001:3001 sample-todo-app
```

The container keeps todo state in memory, so restarting or replacing it clears
the list.

## Publishing to Azure Container Registry

`.github/workflows/publish-container.yml` publishes
`souclouddemo.azurecr.io/sample-todo-app` on pushes to the default `main` branch
and on manual dispatches. Configure this repository Actions secret before
running it:

- `ACR_PASSWORD` — a credential allowed to push to the registry.

The workflow uses the non-secret registry username `souclouddemo`. Every run
publishes an immutable `sha-<full commit SHA>` tag. `latest` is published only
when the workflow runs for `main`; a manual run on another ref receives only
the commit-SHA tag.
