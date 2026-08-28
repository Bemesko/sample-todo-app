import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TITLE_LENGTH = 200;

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...options.headers
    }
  });
  const text = await response.text();

  return {
    response,
    body: text === '' ? null : JSON.parse(text)
  };
}

async function createTodo(baseUrl, title = 'Buy milk') {
  const result = await requestJson(baseUrl, '/api/todos', {
    method: 'POST',
    body: JSON.stringify({ title })
  });

  assert.equal(result.response.status, 201);
  return result.body.todo;
}

async function startTestServer() {
  const app = createApp();

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      app.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      app.off('error', onError);
      resolve();
    };

    app.once('error', onError);
    app.once('listening', onListening);
    app.listen(0, '127.0.0.1');
  });

  const address = app.address();
  assert.ok(address && typeof address === 'object');

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopTestServer(app) {
  await new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withTestServer(callback) {
  const { app, baseUrl } = await startTestServer();

  try {
    return await callback(baseUrl);
  } finally {
    await stopTestServer(app);
  }
}

function assertValidationError(result, details) {
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.body, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request body failed validation.',
      details
    }
  });
}

function assertMethodNotAllowed(result, allow) {
  assert.equal(result.response.status, 405);
  assert.equal(result.response.headers.get('allow'), allow);
  assert.deepEqual(result.body, {
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'The HTTP method is not allowed for this resource.'
    }
  });
}

describe('todo API', () => {
  it('preserves the health endpoint', async () => {
    await withTestServer(async (baseUrl) => {
      const { response, body } = await requestJson(baseUrl, '/api/health');

      assert.equal(response.status, 200);
      assert.deepEqual(body, { status: 'ok' });
    });
  });

  it('lists an empty todo collection initially', async () => {
    await withTestServer(async (baseUrl) => {
      const { response, body } = await requestJson(baseUrl, '/api/todos');

      assert.equal(response.status, 200);
      assert.deepEqual(body, { todos: [] });
    });
  });

  it('creates a todo with a trimmed title and default completion', async () => {
    await withTestServer(async (baseUrl) => {
      const { response, body } = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: '  Buy milk  ' })
      });

      assert.equal(response.status, 201);
      assert.match(response.headers.get('location'), /^\/api\/todos\/[^/]+$/);
      assert.equal(body.todo.title, 'Buy milk');
      assert.equal(body.todo.completed, false);
      assert.match(body.todo.id, /^[0-9a-f-]{36}$/);
    });
  });

  it('lists created todos', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl);
      const { response, body } = await requestJson(baseUrl, '/api/todos');

      assert.equal(response.status, 200);
      assert.ok(body.todos.some((listedTodo) => listedTodo.id === todo.id));
    });
  });

  it('partially updates only the title and preserves completion', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl);
      const completed = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: true })
        }
      );
      const { response, body } = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: '  Buy tea  ' })
        }
      );

      assert.equal(completed.response.status, 200);
      assert.equal(response.status, 200);
      assert.deepEqual(body.todo, {
        id: todo.id,
        title: 'Buy tea',
        completed: true
      });
    });
  });

  it('partially updates only completion and preserves the title', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl, 'Buy tea');
      const { response, body } = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: true })
        }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(body.todo, {
        id: todo.id,
        title: 'Buy tea',
        completed: true
      });
    });
  });

  it('deletes a todo and returns no content', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl);
      const deleted = await requestJson(baseUrl, `/api/todos/${todo.id}`, {
        method: 'DELETE'
      });
      const missing = await requestJson(baseUrl, `/api/todos/${todo.id}`, {
        method: 'DELETE'
      });

      assert.equal(deleted.response.status, 204);
      assert.equal(deleted.body, null);
      assert.equal(missing.response.status, 404);
      assert.equal(missing.body.error.code, 'TODO_NOT_FOUND');
    });
  });

  it('rejects invalid create input with the stable error shape', async () => {
    await withTestServer(async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: '   ' })
      });

      assertValidationError(result, [
        { field: 'title', message: 'Title must not be blank.' }
      ]);
    });
  });

  it('rejects missing, non-string, and unknown create fields', async () => {
    await withTestServer(async (baseUrl) => {
      const missing = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const nonString = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 42 })
      });
      const unknown = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 'Buy milk', completed: true })
      });

      assertValidationError(missing, [
        { field: 'title', message: 'Title is required.' }
      ]);
      assertValidationError(nonString, [
        { field: 'title', message: 'Title must be a string.' }
      ]);
      assertValidationError(unknown, [
        { field: 'completed', message: 'Field is not allowed.' }
      ]);
    });
  });

  it('accepts a 200-character title and rejects longer titles', async () => {
    await withTestServer(async (baseUrl) => {
      const accepted = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 'x'.repeat(MAX_TITLE_LENGTH) })
      });
      const rejected = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })
      });

      assert.equal(accepted.response.status, 201);
      assert.equal(accepted.body.todo.title.length, MAX_TITLE_LENGTH);
      assertValidationError(rejected, [
        {
          field: 'title',
          message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`
        }
      ]);
    });
  });

  it('rejects non-object create bodies', async () => {
    await withTestServer(async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify([])
      });

      assertValidationError(result, [
        { field: 'body', message: 'Request body must be a JSON object.' }
      ]);
    });
  });

  it('rejects malformed JSON', async () => {
    await withTestServer(async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: '{'
      });

      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must contain valid JSON.'
        }
      });
    });
  });

  it('rejects unsupported media types for JSON requests', async () => {
    await withTestServer(async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 'Buy milk' }),
        headers: { 'content-type': 'text/plain' }
      });

      assert.equal(result.response.status, 415);
      assert.deepEqual(result.body, {
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Request content-type must be application/json.'
        }
      });
    });
  });

  it('rejects oversized request bodies before creating a todo', async () => {
    await withTestServer(async (baseUrl) => {
      const result = await requestJson(baseUrl, '/api/todos', {
        method: 'POST',
        body: JSON.stringify({ title: 'x'.repeat(MAX_BODY_BYTES) })
      });
      const list = await requestJson(baseUrl, '/api/todos');

      assert.equal(result.response.status, 413);
      assert.deepEqual(result.body, {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body must be ${MAX_BODY_BYTES} bytes or smaller.`
        }
      });
      assert.deepEqual(list.body, { todos: [] });
    });
  });

  it('rejects empty and unknown partial updates', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl);
      const empty = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({})
        }
      );
      const unknown = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ done: true })
        }
      );

      assertValidationError(empty, [
        { field: 'body', message: 'At least one updatable field is required.' }
      ]);
      assertValidationError(unknown, [
        { field: 'done', message: 'Field is not allowed.' }
      ]);
    });
  });

  it('validates title and completion fields on partial updates', async () => {
    await withTestServer(async (baseUrl) => {
      const todo = await createTodo(baseUrl);
      const blankTitle = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: '  ' })
        }
      );
      const longTitle = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })
        }
      );
      const invalidCompletion = await requestJson(
        baseUrl,
        `/api/todos/${todo.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: 'yes' })
        }
      );

      assertValidationError(blankTitle, [
        { field: 'title', message: 'Title must not be blank.' }
      ]);
      assertValidationError(longTitle, [
        {
          field: 'title',
          message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`
        }
      ]);
      assertValidationError(invalidCompletion, [
        { field: 'completed', message: 'Completed must be a boolean.' }
      ]);
    });
  });

  it('returns method not allowed responses with Allow headers', async () => {
    await withTestServer(async (baseUrl) => {
      const health = await requestJson(baseUrl, '/api/health', {
        method: 'POST'
      });
      const collection = await requestJson(baseUrl, '/api/todos', {
        method: 'PUT'
      });
      const todo = await createTodo(baseUrl);
      const item = await requestJson(baseUrl, `/api/todos/${todo.id}`, {
        method: 'GET'
      });

      assertMethodNotAllowed(health, 'GET');
      assertMethodNotAllowed(collection, 'GET, POST');
      assertMethodNotAllowed(item, 'PATCH, DELETE');
    });
  });

  it('returns not found for missing todos and routes', async () => {
    await withTestServer(async (baseUrl) => {
      const missingTodo = await requestJson(
        baseUrl,
        '/api/todos/does-not-exist',
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: true })
        }
      );
      const missingRoute = await requestJson(baseUrl, '/api/unknown');

      assert.equal(missingTodo.response.status, 404);
      assert.deepEqual(missingTodo.body, {
        error: {
          code: 'TODO_NOT_FOUND',
          message: 'Todo was not found.'
        }
      });
      assert.equal(missingRoute.response.status, 404);
      assert.deepEqual(missingRoute.body, {
        error: {
          code: 'NOT_FOUND',
          message: 'Route was not found.'
        }
      });
    });
  });
});
