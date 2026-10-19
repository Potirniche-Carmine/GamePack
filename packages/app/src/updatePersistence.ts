// Failed writes remain retryable even after their UI caller has handled the error.
// A later successful write to another setting must not hide that failure.
export function createSettingsWrites() {
  type Write = {run: () => Promise<void>; promise: Promise<void>; failed: boolean};
  const writes = new Map<string, Write>();
  const run = (key: string, operation: () => Promise<void>) => {
    const write: Write = {run: operation, promise: Promise.resolve(), failed: false};
    write.promise = (writes.get(key)?.promise ?? Promise.resolve()).catch(() => undefined).then(operation);
    writes.set(key, write);
    void write.promise.then(() => { if (writes.get(key) === write) writes.delete(key); }, () => { write.failed = true; });
    return write.promise;
  };
  return {
    run,
    async flush() {
      while (writes.size) {
        for (const [key, write] of [...writes]) {
          if (writes.get(key) !== write) continue;
          await (write.failed ? run(key, write.run) : write.promise);
        }
      }
    },
  };
}

export async function restartAfterSaving(operations: {
  finishStroke: () => Promise<void>;
  saveDrafts: () => Promise<void>;
  saveSettings: () => Promise<void>;
  install: () => Promise<void>;
}): Promise<void> {
  await operations.finishStroke();
  await operations.saveDrafts();
  await operations.saveSettings();
  await operations.install();
}

export async function saveEveryDraft<T extends {id: string}>(getDrafts: () => readonly T[], save: (id: string) => Promise<T>): Promise<void> {
  const saved = new Map<string, T>();
  while (true) {
    const draft = getDrafts().find(value => saved.get(value.id) !== value);
    if (!draft) return;
    saved.set(draft.id, await save(draft.id));
  }
}
