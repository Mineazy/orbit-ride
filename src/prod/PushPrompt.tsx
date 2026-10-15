import React from 'react';
import { Bell } from 'lucide-react';
import { usePush } from './push';
import { ErrorNote } from './ui';

const COPY = {
  passenger: { title: 'Know when your driver arrives', text: 'Turn on notifications to hear when a driver accepts, arrives or cancels, even when the app is closed.' },
  driver: { title: 'Never miss a ride request', text: 'Turn on notifications to hear about ride requests near you, even when the app is closed.' },
};

/** A small card offering notifications. Shows nothing once they are on, or when this device cannot do them. */
export default function PushPrompt({ role }: { role: 'passenger' | 'driver' }) {
  const { state, busy, error, enable } = usePush();
  if (state !== 'off' && state !== 'denied') return null;

  return (
    <section className="glass-panel p-3 flex items-start gap-3" aria-label="Notifications">
      <Bell size={18} className="text-cyan-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div>
          <p className="text-xs font-bold">{COPY[role].title}</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {state === 'denied' ? 'Notifications are blocked. Allow them for this app in your phone or browser settings, then come back.' : COPY[role].text}
          </p>
        </div>
        <ErrorNote message={error} />
        {state === 'off' && (
          <button className="btn-primary px-4 py-2 text-xs w-fit" disabled={busy} onClick={() => void enable()}>
            {busy ? 'Turning on...' : 'Turn on notifications'}
          </button>
        )}
      </div>
    </section>
  );
}
