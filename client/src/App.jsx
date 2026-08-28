import { useEffect, useId, useRef, useState } from 'react';
import { useTodos } from './useTodos.js';

const MAX_TITLE_LENGTH = 200;

function getFieldError(error, field) {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) {
    return '';
  }

  return (
    error.details.find((detail) => detail?.field === field)?.message ?? ''
  );
}

function getListErrorMessage(error) {
  if (error?.code === 'NETWORK_ERROR') {
    return 'We could not reach the todo service. Check your connection and try again.';
  }

  if (error?.status >= 500) {
    return 'The todo service is having trouble. Please try again.';
  }

  return error?.message || 'Your todos could not be loaded. Please try again.';
}

function getMutationErrorMessage(error, action) {
  if (error?.code === 'NETWORK_ERROR') {
    return `We could not ${action} because the service is unavailable. Try again.`;
  }

  if (error?.status >= 500) {
    return `We could not ${action}. Please try again.`;
  }

  if (error?.status === 404) {
    return 'This todo is no longer available. Refresh the list and try again.';
  }

  if (error?.code === 'VALIDATION_ERROR') {
    return 'Please review the highlighted field.';
  }

  return error?.message || `We could not ${action}. Please try again.`;
}

function validateTitle(value) {
  const title = value.trim();

  if (title.length === 0) {
    return 'Title must not be blank.';
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
  }

  return '';
}

function NewTodoForm({ isCreating, onCreate, onAnnounce }) {
  const titleInputId = useId();
  const titleErrorId = useId();
  const titleHintId = useId();
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [generalError, setGeneralError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setFieldError('');
    setGeneralError('');

    const validationError = validateTitle(draft);

    if (validationError) {
      setFieldError(validationError);
      onAnnounce(validationError);
      return;
    }

    try {
      const result = await onCreate(draft.trim());

      if (result?.todo) {
        setDraft('');
        onAnnounce(`Added "${result.todo.title}".`);
      } else if (result?.reconciled) {
        const message =
          'The list was refreshed, but this todo could not be added. Try again.';
        setGeneralError(message);
        onAnnounce(message);
      }
    } catch (error) {
      const nextFieldError = getFieldError(error, 'title');

      if (nextFieldError) {
        setFieldError(nextFieldError);
        onAnnounce(nextFieldError);
      } else {
        const message = getMutationErrorMessage(error, 'add this todo');
        setGeneralError(message);
        onAnnounce(message);
      }
    }
  }

  return (
    <form className="new-todo-form" onSubmit={handleSubmit} noValidate>
      <div className="field-heading">
        <label htmlFor={titleInputId}>Add a todo</label>
        <span id={titleHintId} className="field-hint">
          Up to {MAX_TITLE_LENGTH} characters
        </span>
      </div>
      <div className="new-todo-controls">
        <input
          id={titleInputId}
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (fieldError) {
              setFieldError('');
            }
            if (generalError) {
              setGeneralError('');
            }
          }}
          placeholder="e.g. Book a dentist appointment"
          maxLength={MAX_TITLE_LENGTH + 1}
          disabled={isCreating}
          aria-invalid={fieldError ? 'true' : 'false'}
          aria-describedby={
            fieldError ? `${titleHintId} ${titleErrorId}` : titleHintId
          }
        />
        <button type="submit" disabled={isCreating}>
          {isCreating ? 'Adding…' : 'Add todo'}
        </button>
      </div>
      {fieldError ? (
        <p id={titleErrorId} className="field-error" role="alert">
          {fieldError}
        </p>
      ) : null}
      {generalError ? (
        <p className="form-error" role="alert">
          {generalError}
        </p>
      ) : null}
    </form>
  );
}

function TodoRow({ todo, busy, onUpdate, onDelete, onAnnounce }) {
  const checkboxId = useId();
  const editInputId = useId();
  const editErrorId = useId();
  const actionErrorId = useId();
  const editInputRef = useRef(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [fieldError, setFieldError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
    }
  }, [isEditing]);

  function startEditing() {
    setDraft(todo.title);
    setFieldError('');
    setActionError('');
    setIsEditing(true);
  }

  function cancelEditing() {
    setFieldError('');
    setActionError('');
    setIsEditing(false);
  }

  async function handleToggle() {
    setActionError('');

    try {
      const result = await onUpdate(todo.id, {
        completed: !todo.completed
      });

      if (result?.reconciled) {
        onAnnounce(`"${todo.title}" was no longer available. The list was refreshed.`);
        return;
      }

      onAnnounce(
        todo.completed
          ? `Marked "${todo.title}" as active.`
          : `Marked "${todo.title}" as complete.`
      );
    } catch (error) {
      const message = getMutationErrorMessage(error, 'update this todo');
      setActionError(message);
      onAnnounce(message);
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    setFieldError('');
    setActionError('');

    const validationError = validateTitle(draft);

    if (validationError) {
      setFieldError(validationError);
      onAnnounce(validationError);
      return;
    }

    try {
      const result = await onUpdate(todo.id, { title: draft.trim() });

      if (result?.reconciled) {
        setIsEditing(false);
        onAnnounce(`"${todo.title}" was no longer available. The list was refreshed.`);
        return;
      }

      setIsEditing(false);
      onAnnounce(`Updated "${draft.trim()}".`);
    } catch (error) {
      const nextFieldError = getFieldError(error, 'title');

      if (nextFieldError) {
        setFieldError(nextFieldError);
        onAnnounce(nextFieldError);
      } else {
        const message = getMutationErrorMessage(error, 'save this todo');
        setActionError(message);
        onAnnounce(message);
      }
    }
  }

  async function handleDelete() {
    setActionError('');

    try {
      const result = await onDelete(todo.id);

      if (result?.reconciled) {
        onAnnounce(`"${todo.title}" was already removed. The list was refreshed.`);
        return;
      }

      onAnnounce(`Deleted "${todo.title}".`);
    } catch (error) {
      const message = getMutationErrorMessage(error, 'delete this todo');
      setActionError(message);
      onAnnounce(message);
    }
  }

  return (
    <li className={`todo-row${todo.completed ? ' is-complete' : ''}`} aria-busy={busy}>
      <div className="todo-row-main">
        <input
          id={checkboxId}
          className="todo-checkbox"
          type="checkbox"
          checked={todo.completed}
          onChange={handleToggle}
          disabled={busy}
          aria-label={`${todo.completed ? 'Mark' : 'Complete'} "${todo.title}"`}
          aria-describedby={actionError ? actionErrorId : undefined}
        />
        {isEditing ? (
          <form className="edit-form" onSubmit={handleEditSubmit} noValidate>
            <label className="sr-only" htmlFor={editInputId}>
              Edit title for &quot;{todo.title}&quot;
            </label>
            <input
              ref={editInputRef}
              id={editInputId}
              type="text"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (fieldError) {
                  setFieldError('');
                }
                if (actionError) {
                  setActionError('');
                }
              }}
              maxLength={MAX_TITLE_LENGTH + 1}
              disabled={busy}
              aria-invalid={fieldError ? 'true' : 'false'}
              aria-describedby={
                [fieldError && editErrorId, actionError && actionErrorId]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button type="button" className="button-subtle" onClick={cancelEditing} disabled={busy}>
              Cancel
            </button>
            {fieldError ? (
              <p id={editErrorId} className="field-error" role="alert">
                {fieldError}
              </p>
            ) : null}
          </form>
        ) : (
          <label className="todo-label" htmlFor={checkboxId}>
            <span className="todo-title">{todo.title}</span>
            <span className="todo-state">
              {todo.completed ? 'Complete' : 'Open'}
            </span>
          </label>
        )}
      </div>
      <div
        className="todo-actions"
        role="group"
        aria-label={`Actions for ${todo.title}`}
      >
        {!isEditing ? (
          <button
            type="button"
            className="button-subtle"
            onClick={startEditing}
            disabled={busy}
            aria-label={`Edit "${todo.title}"`}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="button-danger"
          onClick={handleDelete}
          disabled={busy}
          aria-label={`Delete "${todo.title}"`}
        >
          Delete
        </button>
      </div>
      {busy ? (
        <span className="row-status" role="status" aria-live="polite">
          Saving…
        </span>
      ) : null}
      {actionError ? (
        <p id={actionErrorId} className="todo-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </li>
  );
}

function LoadingState() {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <h3>Loading your todos</h3>
        <p>Getting the latest list now.</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="state-card empty-state">
      <span className="empty-mark" aria-hidden="true">
        ✓
      </span>
      <div>
        <h3>Nothing on your list yet</h3>
        <p>Add one small thing above and make it your next win.</p>
      </div>
    </div>
  );
}

export default function App() {
  const {
    todos,
    status,
    error,
    retry,
    createTodo,
    updateTodo,
    deleteTodo,
    pendingIds,
    isCreating
  } = useTodos();
  const [announcement, setAnnouncement] = useState('');

  const remainingCount = todos.filter((todo) => !todo.completed).length;
  const listErrorMessage = getListErrorMessage(error);

  return (
    <main className="app-shell">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <header className="app-header">
        <p className="eyebrow">Sample Todo App</p>
        <h1>Make room for what comes next.</h1>
        <p className="intro">
          Keep the list small, make progress visible, and let each completed
          thing earn its checkmark.
        </p>
      </header>

      <section className="todo-card" aria-labelledby="todo-list-heading">
        <div className="todo-card-heading">
          <div>
            <p className="section-kicker">Your list</p>
            <h2 id="todo-list-heading">Today&apos;s todos</h2>
          </div>
          <p className="todo-count" aria-live="polite">
            {remainingCount === 1
              ? '1 open'
              : `${remainingCount} open`}
          </p>
        </div>

        <NewTodoForm
          isCreating={isCreating}
          onCreate={createTodo}
          onAnnounce={setAnnouncement}
        />

        {status === 'refreshing' ? (
          <p className="refresh-status" role="status" aria-live="polite">
            Updating your list…
          </p>
        ) : null}

        {status === 'loading' ? <LoadingState /> : null}

        {status === 'error' ? (
          <div className="list-error" role="alert">
            <div>
              <h3>We hit a snag</h3>
              <p>{listErrorMessage}</p>
            </div>
            <button type="button" onClick={() => void retry()}>
              Try again
            </button>
          </div>
        ) : null}

        {status !== 'loading' &&
        !(status === 'error' && todos.length === 0) &&
        todos.length === 0 ? (
          <EmptyState />
        ) : null}

        {todos.length > 0 ? (
          <ul className="todo-list">
            {todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                busy={pendingIds.has(todo.id)}
                onUpdate={updateTodo}
                onDelete={deleteTodo}
                onAnnounce={setAnnouncement}
              />
            ))}
          </ul>
        ) : null}
      </section>
      <footer className="app-footer">
        <span>{todos.length} {todos.length === 1 ? 'todo' : 'todos'} total</span>
        <span>Changes sync automatically</span>
      </footer>
    </main>
  );
}
