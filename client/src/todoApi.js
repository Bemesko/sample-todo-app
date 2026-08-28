export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class NetworkError extends Error {
  constructor(message = 'The todo service could not be reached.') {
    super(message);
    this.name = 'NetworkError';
    this.code = 'NETWORK_ERROR';
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

async function readResponseBody(response) {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  let text;

  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new NetworkError();
  }

  if (text.trim() === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request(path, options = {}) {
  const { body, headers, ...requestOptions } = options;
  let response;

  try {
    response = await fetch(path, {
      ...requestOptions,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      ...(body === undefined
        ? {}
        : {
            body: typeof body === 'string' ? body : JSON.stringify(body)
          })
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new NetworkError();
  }

  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    const payload = responseBody?.error;

    throw new ApiError(
      response.status,
      typeof payload?.code === 'string' ? payload.code : 'HTTP_ERROR',
      typeof payload?.message === 'string'
        ? payload.message
        : 'The request could not be completed.',
      Array.isArray(payload?.details) ? payload.details : undefined
    );
  }

  return responseBody;
}

function getTodoFromResponse(response) {
  if (!response?.todo || typeof response.todo !== 'object') {
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'The todo service returned an invalid todo.'
    );
  }

  return response.todo;
}

export async function listTodos(options = {}) {
  const response = await request('/api/todos', {
    ...options,
    method: 'GET'
  });

  if (!Array.isArray(response?.todos)) {
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'The todo service returned an invalid list.'
    );
  }

  return response.todos;
}

export async function createTodo(title, options = {}) {
  const response = await request('/api/todos', {
    ...options,
    method: 'POST',
    body: { title }
  });

  return getTodoFromResponse(response);
}

export async function updateTodo(id, patch, options = {}) {
  const response = await request(`/api/todos/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PATCH',
    body: patch
  });

  return getTodoFromResponse(response);
}

export async function deleteTodo(id, options = {}) {
  await request(`/api/todos/${encodeURIComponent(id)}`, {
    ...options,
    method: 'DELETE'
  });
}
