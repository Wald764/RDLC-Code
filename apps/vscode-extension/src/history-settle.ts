/** How long a native history command may take to reach the extension host. */
export const HISTORY_SETTLE_TIMEOUT_MS = 2_000;

/** The extension-host view of a document, reduced to what settling needs. */
export interface VersionedDocument {
  readonly version: number;
  readonly isClosed: boolean;
}

/**
 * Native commands are routed through the workbench: awaiting `undo` or `redo`
 * resolves once the workbench applied it, which can be before the extension
 * host mirror of the document received the change (observed on macOS). The
 * observed version is only trustworthy once the change arrived or it is
 * certain none will: wait for a real change event, bounded, never poll.
 *
 * Resolves true when the document moved off `baseline`, false when it stayed
 * (an empty history, or a command the workbench routed elsewhere), or when
 * the document closed meanwhile (reported promptly through `onClose`).
 */
export function settleHistoryChange(
  document: VersionedDocument,
  baseline: number,
  onChange: (listener: () => void) => { dispose(): void },
  onClose: (listener: () => void) => { dispose(): void },
  timeoutMs = HISTORY_SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  const moved = (): boolean => document.version !== baseline;
  if (moved()) return Promise.resolve(true);
  if (document.isClosed) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const state: {
      done: boolean;
      timer?: NodeJS.Timeout;
      subscriptions: { dispose(): void }[];
    } = { done: false, subscriptions: [] };
    const finish = (value: boolean): void => {
      if (state.done) return;
      state.done = true;
      clearTimeout(state.timer);
      for (const subscription of state.subscriptions) subscription.dispose();
      resolve(value);
    };
    state.timer = setTimeout(() => finish(moved()), timeoutMs);
    state.subscriptions.push(
      onChange(() => {
        if (moved() || document.isClosed) finish(moved());
      }),
    );
    state.subscriptions.push(onClose(() => finish(moved())));
    // A listener that fired during subscription could not release itself yet.
    if (state.done)
      for (const subscription of state.subscriptions) subscription.dispose();
  });
}
