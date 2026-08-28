import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createTodo as createTodoRequest,
  deleteTodo as deleteTodoRequest,
  listTodos,
  updateTodo as updateTodoRequest
} from './todoApi.js';

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function useTodos() {
  const [listState, setListState] = useState({
    status: 'loading',
    todos: [],
    error: null
  });
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [creatingCount, setCreatingCount] = useState(0);

  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const listAbortRef = useRef(null);
  const mutationVersionRef = useRef(0);
  const activeMutationCountRef = useRef(0);
  const listRefreshNeededRef = useRef(false);
  const todoQueuesRef = useRef(new Map());
  const pendingCountsRef = useRef(new Map());
  const collectionQueueRef = useRef(Promise.resolve());
  const collectionPendingCountRef = useRef(0);

  const setTodoPending = useCallback((id, amount) => {
    const counts = pendingCountsRef.current;
    const nextCount = (counts.get(id) ?? 0) + amount;

    if (nextCount > 0) {
      counts.set(id, nextCount);
    } else {
      counts.delete(id);
    }

    if (mountedRef.current) {
      setPendingIds(new Set(counts.keys()));
    }
  }, []);

  const applyTodo = useCallback((todo) => {
    if (!mountedRef.current) {
      return;
    }

    hasLoadedRef.current = true;

    setListState((current) => {
      const index = current.todos.findIndex((existingTodo) => existingTodo.id === todo.id);

      if (index === -1) {
        return {
          ...current,
          status: 'success',
          error: null,
          todos: [...current.todos, todo]
        };
      }

      const todos = current.todos.slice();
      todos[index] = todo;

      return {
        ...current,
        status: 'success',
        error: null,
        todos
      };
    });
  }, []);

  const removeTodo = useCallback((id) => {
    if (!mountedRef.current) {
      return;
    }

    hasLoadedRef.current = true;

    setListState((current) => ({
      ...current,
      status: 'success',
      error: null,
      todos: current.todos.filter((todo) => todo.id !== id)
    }));
  }, []);

  const loadTodos = useCallback(async ({ allowDuringMutations = false } = {}) => {
    const requestId = ++listRequestIdRef.current;
    const mutationVersionAtStart = mutationVersionRef.current;
    const mutationActiveAtStart = activeMutationCountRef.current > 0;

    if (mutationActiveAtStart && !allowDuringMutations) {
      listRefreshNeededRef.current = true;
    }

    listAbortRef.current?.abort();

    const controller = new AbortController();
    listAbortRef.current = controller;

    if (mountedRef.current) {
      setListState((current) => ({
        ...current,
        status: hasLoadedRef.current ? 'refreshing' : 'loading',
        error: null
      }));
    }

    try {
      const todos = await listTodos({ signal: controller.signal });
      const requestIsCurrent = requestId === listRequestIdRef.current;
      const mutationChanged = mutationVersionRef.current !== mutationVersionAtStart;
      const responseIsStale =
        !requestIsCurrent ||
        controller.signal.aborted ||
        mutationChanged ||
        (!allowDuringMutations && mutationActiveAtStart);

      if (responseIsStale) {
        return { stale: true };
      }

      hasLoadedRef.current = true;

      if (mountedRef.current) {
        setListState({
          status: 'success',
          todos,
          error: null
        });
      }

      return { ok: true, todos };
    } catch (error) {
      const requestIsCurrent = requestId === listRequestIdRef.current;
      const mutationChanged = mutationVersionRef.current !== mutationVersionAtStart;
      const responseIsStale =
        isAbortError(error) ||
        controller.signal.aborted ||
        !requestIsCurrent ||
        !mountedRef.current ||
        mutationChanged ||
        (!allowDuringMutations && mutationActiveAtStart);

      if (responseIsStale) {
        return { stale: true };
      }

      setListState((current) => ({
        ...current,
        status: 'error',
        error
      }));

      return { ok: false, error };
    } finally {
      if (requestId === listRequestIdRef.current) {
        listAbortRef.current = null;
      }
    }
  }, []);

  const refreshListAfterMutations = useCallback((reconciled = false) => {
    if (reconciled && activeMutationCountRef.current === 0) {
      listRefreshNeededRef.current = false;
      return;
    }

    if (
      !listRefreshNeededRef.current ||
      activeMutationCountRef.current > 0 ||
      !mountedRef.current
    ) {
      return;
    }

    listRefreshNeededRef.current = false;
    void loadTodos();
  }, [loadTodos]);

  const enqueueTodoMutation = useCallback(
    (id, operation) => {
      mutationVersionRef.current += 1;
      activeMutationCountRef.current += 1;
      if (listAbortRef.current !== null) {
        listRefreshNeededRef.current = true;
      }
      setTodoPending(id, 1);

      const previous = todoQueuesRef.current.get(id) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(operation);
      let settled;

      const cleanup = () => {
        activeMutationCountRef.current = Math.max(
          0,
          activeMutationCountRef.current - 1
        );
        setTodoPending(id, -1);

        if (todoQueuesRef.current.get(id) === settled) {
          todoQueuesRef.current.delete(id);
        }
      };

      settled = current.then(
        (value) => {
          cleanup();
          refreshListAfterMutations(value?.reconciled);

          return value;
        },
        (error) => {
          cleanup();
          refreshListAfterMutations();

          return undefined;
        }
      );

      todoQueuesRef.current.set(id, settled);

      return current;
    },
    [refreshListAfterMutations, setTodoPending]
  );

  const enqueueCollectionMutation = useCallback((operation) => {
    mutationVersionRef.current += 1;
    activeMutationCountRef.current += 1;
    collectionPendingCountRef.current += 1;
    if (listAbortRef.current !== null) {
      listRefreshNeededRef.current = true;
    }

    if (mountedRef.current) {
      setCreatingCount(collectionPendingCountRef.current);
    }

    const previous = collectionQueueRef.current;
    const current = previous.catch(() => undefined).then(operation);
    let settled;

    const cleanup = () => {
      activeMutationCountRef.current = Math.max(
        0,
        activeMutationCountRef.current - 1
      );
      collectionPendingCountRef.current = Math.max(
        0,
        collectionPendingCountRef.current - 1
      );

      if (mountedRef.current) {
        setCreatingCount(collectionPendingCountRef.current);
      }

      if (collectionQueueRef.current === settled) {
        collectionQueueRef.current = Promise.resolve();
      }
    };

    settled = current.then(
      (value) => {
        cleanup();
        refreshListAfterMutations(value?.reconciled);

        return value;
      },
      (error) => {
        cleanup();
        refreshListAfterMutations();

        return undefined;
      }
    );

    collectionQueueRef.current = settled;

    return current;
  }, [refreshListAfterMutations]);

  const reconcileNotFound = useCallback(
    async (error) => {
      if (error?.status !== 404) {
        throw error;
      }

      const refresh = await loadTodos({ allowDuringMutations: true });

      if (!refresh.ok) {
        throw refresh.error ?? error;
      }

      return { reconciled: true };
    },
    [loadTodos]
  );

  const createTodo = useCallback(
    (title) =>
      enqueueCollectionMutation(async () => {
        try {
          const todo = await createTodoRequest(title);
          applyTodo(todo);
          return { todo };
        } catch (error) {
          return reconcileNotFound(error);
        }
      }),
    [applyTodo, enqueueCollectionMutation, reconcileNotFound]
  );

  const updateTodo = useCallback(
    (id, patch) =>
      enqueueTodoMutation(id, async () => {
        try {
          const todo = await updateTodoRequest(id, patch);
          applyTodo(todo);
          return { todo };
        } catch (error) {
          return reconcileNotFound(error);
        }
      }),
    [applyTodo, enqueueTodoMutation, reconcileNotFound]
  );

  const deleteTodo = useCallback(
    (id) =>
      enqueueTodoMutation(id, async () => {
        try {
          await deleteTodoRequest(id);
          removeTodo(id);
          return { deleted: true };
        } catch (error) {
          return reconcileNotFound(error);
        }
      }),
    [enqueueTodoMutation, reconcileNotFound, removeTodo]
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadTodos();

    return () => {
      mountedRef.current = false;
      listAbortRef.current?.abort();
    };
  }, [loadTodos]);

  return {
    todos: listState.todos,
    status: listState.status,
    error: listState.error,
    retry: loadTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    pendingIds,
    isCreating: creatingCount > 0
  };
}
