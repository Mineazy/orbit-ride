import { getBackend } from './backend';

// Sends app crashes and unexpected errors to the server (report_client_error) so an admin can see them.
// It never throws and never reports the same message twice or more than 10 times in one session.

type App = 'passenger' | 'driver' | 'admin' | 'unknown';

const seen = new Set<string>();
let sent = 0;

export function reportError(app: App, error: unknown): void {
  try {
    const message = String((error as { message?: string } | null)?.message ?? error ?? 'Unknown error');
    if (seen.has(message) || sent >= 10) return;
    seen.add(message);
    sent++;
    const stack = (error as { stack?: string } | null)?.stack;
    void getBackend()
      .then((client) => client.rpc('report_client_error', { p_app: app, p_message: message, p_stack: stack ?? null, p_url: window.location.pathname + window.location.search }))
      .catch(() => {});
  } catch {
    /* reporting must never cause a problem of its own */
  }
}

/** Report errors that nothing else caught. Returns a function that removes the listeners. */
export function installErrorReporting(app: App): () => void {
  const onError = (e: ErrorEvent) => reportError(app, e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => reportError(app, e.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
