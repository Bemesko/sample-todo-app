import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const TODO_COLLECTION_PATH = '/api/todos';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TITLE_LENGTH = 200;
const CREATE_FIELDS = new Set(['title']);
const UPDATE_FIELDS = new Set(['title', 'completed']);
const STATIC_CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function sendJson(response, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers
  });
  response.end(payload);
}

function sendNoContent(response) {
  response.writeHead(204);
  response.end();
}

function getRequestPathname(requestUrl) {
  try {
    return new URL(requestUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return '<invalid>';
  }
}

function createRequestTelemetry(request, response, requestId, startedAt) {
  return JSON.stringify({
    event: 'http.request',
    requestId,
    method: request.method ?? 'GET',
    pathname: getRequestPathname(request.url),
    status: response.writableEnded ? response.statusCode : 0,
    durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n)
  });
}

function sendError(
  response,
  statusCode,
  code,
  message,
  details,
  headers = {}
) {
  const error = { code, message };

  if (details !== undefined) {
    error.details = details;
  }

  sendJson(response, statusCode, { error }, headers);
}

function isJsonContentType(request) {
  const contentType = request.headers['content-type'];

  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json'
  );
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    let tooLarge = false;

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      bodyBytes += Buffer.byteLength(chunk, 'utf8');

      if (bodyBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }

      body += chunk;
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(
          new ApiError(
            413,
            'PAYLOAD_TOO_LARGE',
            `Request body must be ${MAX_BODY_BYTES} bytes or smaller.`
          )
        );
        return;
      }

      if (body.trim() === '') {
        reject(
          new ApiError(400, 'INVALID_JSON', 'Request body must contain JSON.')
        );
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(
          new ApiError(400, 'INVALID_JSON', 'Request body must contain valid JSON.')
        );
      }
    });
    request.on('error', (error) => {
      reject(error);
    });
  });
}

async function parseJsonBody(request) {
  if (!isJsonContentType(request)) {
    request.resume();
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Request content-type must be application/json.'
    );
  }

  return readJsonBody(request);
}

function validationError(details) {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'Request body failed validation.',
    details
  );
}

function validateFields(body, allowedFields) {
  if (!isObject(body)) {
    throw validationError([
      { field: 'body', message: 'Request body must be a JSON object.' }
    ]);
  }

  return Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => ({ field, message: 'Field is not allowed.' }));
}

function validateTitle(value, details) {
  if (typeof value !== 'string') {
    details.push({ field: 'title', message: 'Title must be a string.' });
    return;
  }

  const title = value.trim();

  if (title.length === 0) {
    details.push({ field: 'title', message: 'Title must not be blank.' });
  } else if (title.length > MAX_TITLE_LENGTH) {
    details.push({
      field: 'title',
      message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`
    });
  }
}

function validateCreate(body) {
  const details = validateFields(body, CREATE_FIELDS);

  if (!isObject(body)) {
    throw validationError(details);
  }

  if (!Object.hasOwn(body, 'title')) {
    details.push({ field: 'title', message: 'Title is required.' });
  } else {
    validateTitle(body.title, details);
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  return { title: body.title.trim() };
}

function validateUpdate(body) {
  const details = validateFields(body, UPDATE_FIELDS);

  if (!isObject(body)) {
    throw validationError(details);
  }

  if (Object.keys(body).length === 0) {
    details.push({
      field: 'body',
      message: 'At least one updatable field is required.'
    });
  }

  if (Object.hasOwn(body, 'title')) {
    validateTitle(body.title, details);
  }

  if (Object.hasOwn(body, 'completed') && typeof body.completed !== 'boolean') {
    details.push({ field: 'completed', message: 'Completed must be a boolean.' });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  const update = {};

  if (Object.hasOwn(body, 'title')) {
    update.title = body.title.trim();
  }

  if (Object.hasOwn(body, 'completed')) {
    update.completed = body.completed;
  }

  return update;
}

function getTodoId(pathname, { decodeId = true } = {}) {
  const prefix = `${TODO_COLLECTION_PATH}/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const encodedId = pathname.slice(prefix.length);

  if (encodedId === '' || encodedId.includes('/')) {
    return null;
  }

  if (!decodeId) {
    return encodedId;
  }

  try {
    const id = decodeURIComponent(encodedId);
    return id === '' || id.includes('/') ? null : id;
  } catch {
    return null;
  }
}

function sendMethodNotAllowed(response, allowedMethods) {
  sendError(
    response,
    405,
    'METHOD_NOT_ALLOWED',
    'The HTTP method is not allowed for this resource.',
    undefined,
    { allow: allowedMethods }
  );
}

function sendNotFound(response, code, message) {
  sendError(response, 404, code, message);
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isApiPath(pathname) {
  const decodedPathname = decodePathname(pathname);

  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    decodedPathname === '/api' ||
    decodedPathname?.startsWith('/api/')
  );
}

function getSafeStaticPath(staticDir, pathname) {
  let decodedPathname;

  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath =
    decodedPathname === '/' ? 'index.html' : decodedPathname.slice(1);
  const filePath = resolve(staticDir, relativePath);
  const pathFromRoot = relative(staticDir, filePath);

  if (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }

  return { decodedPathname, filePath };
}

async function resolveStaticFile(staticDir, pathname) {
  const requestedPath = getSafeStaticPath(staticDir, pathname);

  if (requestedPath === null) {
    return null;
  }

  try {
    const fileStats = await stat(requestedPath.filePath);

    if (fileStats.isFile()) {
      return requestedPath;
    }
  } catch {
    // Fall through to the SPA entry point for client-side routes.
  }

  if (
    requestedPath.decodedPathname !== '/' &&
    extname(requestedPath.decodedPathname) === ''
  ) {
    const indexPath = getSafeStaticPath(staticDir, '/');

    if (indexPath === null) {
      return null;
    }

    try {
      const indexStats = await stat(indexPath.filePath);

      if (indexStats.isFile()) {
        return indexPath;
      }
    } catch {
      // A missing static directory is handled as an ordinary 404.
    }
  }

  return null;
}

async function serveStatic(request, response, staticDir, pathname) {
  if (
    staticDir === null ||
    !['GET', 'HEAD'].includes(request.method) ||
    isApiPath(pathname)
  ) {
    return false;
  }

  const staticFile = await resolveStaticFile(staticDir, pathname);

  if (staticFile === null) {
    return false;
  }

  const payload = await readFile(staticFile.filePath);
  const extension = extname(staticFile.filePath).toLowerCase();

  response.writeHead(200, {
    'cache-control':
      extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-length': payload.byteLength,
    'content-type':
      STATIC_CONTENT_TYPES.get(extension) ?? 'application/octet-stream'
  });
  response.end(request.method === 'HEAD' ? undefined : payload);

  return true;
}

async function handleRequest(request, response, todos, staticDir) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const decodedPathname = decodePathname(url.pathname);
  const pathname = decodedPathname ?? url.pathname;
  const method = request.method ?? 'GET';

  if (pathname === '/api/health') {
    if (method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return;
    }

    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (pathname === TODO_COLLECTION_PATH) {
    if (method === 'GET') {
      sendJson(response, 200, { todos: [...todos.values()] });
      return;
    }

    if (method === 'POST') {
      const body = await parseJsonBody(request);
      const input = validateCreate(body);
      const todo = {
        id: randomUUID(),
        title: input.title,
        completed: false
      };

      todos.set(todo.id, todo);
      sendJson(response, 201, { todo }, { location: `${TODO_COLLECTION_PATH}/${todo.id}` });
      return;
    }

    sendMethodNotAllowed(response, 'GET, POST');
    return;
  }

  const todoId =
    decodedPathname === null
      ? null
      : getTodoId(pathname, { decodeId: false });

  if (todoId !== null) {
    if (method === 'PATCH') {
      if (!todos.has(todoId)) {
        sendNotFound(response, 'TODO_NOT_FOUND', 'Todo was not found.');
        return;
      }

      const body = await parseJsonBody(request);
      const update = validateUpdate(body);
      const todo = todos.get(todoId);

      Object.assign(todo, update);
      sendJson(response, 200, { todo });
      return;
    }

    if (method === 'DELETE') {
      if (!todos.delete(todoId)) {
        sendNotFound(response, 'TODO_NOT_FOUND', 'Todo was not found.');
        return;
      }

      sendNoContent(response);
      return;
    }

    sendMethodNotAllowed(response, 'PATCH, DELETE');
    return;
  }

  if (await serveStatic(request, response, staticDir, url.pathname)) {
    return;
  }

  sendNotFound(response, 'NOT_FOUND', 'Route was not found.');
}

export function createApp({
  staticDir,
  logger = (message) => console.log(message)
} = {}) {
  const todos = new Map();
  const resolvedStaticDir = staticDir == null ? null : resolve(staticDir);

  return createServer((request, response) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    let telemetryLogged = false;

    response.setHeader('x-request-id', requestId);

    const logRequest = () => {
      if (telemetryLogged) {
        return;
      }

      telemetryLogged = true;
      logger(createRequestTelemetry(request, response, requestId, startedAt));
    };

    response.once('finish', logRequest);
    response.once('close', logRequest);

    handleRequest(request, response, todos, resolvedStaticDir).catch((error) => {
      if (response.writableEnded) {
        return;
      }

      if (error instanceof ApiError) {
        sendError(
          response,
          error.statusCode,
          error.code,
          error.message,
          error.details
        );
        return;
      }

      sendError(
        response,
        500,
        'INTERNAL_SERVER_ERROR',
        'An unexpected server error occurred.'
      );
    });
  });
}
