type LockMode = 'exclusive' | 'shared';

interface MinimalLockManager {
  request<T>(
    name: string,
    options: { mode?: LockMode },
    callback: () => Promise<T> | T,
  ): Promise<T>;
}

function resolveLockManager(): MinimalLockManager | null {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
  const lockManager = nav?.locks;
  if (!lockManager || typeof (lockManager as MinimalLockManager).request !== 'function') {
    return null;
  }
  return lockManager as MinimalLockManager;
}

function createInProcessQueue() {
  let queueTail: Promise<void> = Promise.resolve();
  return async <T>(task: () => Promise<T>): Promise<T> => {
    const run = queueTail.then(task, task);
    queueTail = run.then(() => undefined, () => undefined);
    return run;
  };
}

const LOCK_NAMESPACE = 'tactus-storage';

export function createMutationGate(lockName: string) {
  const inProcessQueue = createInProcessQueue();
  const fullLockName = `${LOCK_NAMESPACE}:${lockName}`;

  return async <T>(task: () => Promise<T>): Promise<T> => {
    const lockManager = resolveLockManager();
    if (!lockManager) {
      return inProcessQueue(task);
    }
    return lockManager.request(fullLockName, { mode: 'exclusive' }, task);
  };
}
