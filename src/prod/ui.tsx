import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, LogOut, Navigation } from 'lucide-react';
import { useAuth } from './AuthContext';
import type { RideStatus } from './types';

// Shared building blocks for the production apps. Styling reuses the app design tokens (index.css).

export const money = (n: number | string | null | undefined): string => `N$${(Number(n) || 0).toFixed(2)}`;
export const num = (n: number | string | null | undefined): number => Number(n) || 0;

export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-text-muted" role="status">
      <Loader2 size={28} className="animate-spin text-cyan-400" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </p>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'good' | 'warn' }) {
  const styles = {
    info: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
    good: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  }[tone];
  return (
    <div role="status" className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

const STATUS_LOOK: Record<RideStatus, { label: string; cls: string }> = {
  REQUESTED: { label: 'Waiting for a driver', cls: 'bg-amber-500/15 border-amber-500/30 text-amber-400' },
  ACCEPTED: { label: 'Driver on the way', cls: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400' },
  ARRIVED: { label: 'Driver at pickup', cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
  IN_PROGRESS: { label: 'On trip', cls: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-white/5 border-white/10 text-text-muted' },
};

export function StatusPill({ status }: { status: RideStatus }) {
  const look = STATUS_LOOK[status];
  return <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${look.cls}`}>{look.label}</span>;
}

/** Ticking m:ss since a timestamp */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>;
}

/** Page chrome: brand header with the signed-in person and a sign-out button */
export function Shell({ title, wide = false, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-bg-deep text-white flex flex-col">
      <header className="glass-panel rounded-none border-t-0 border-x-0 px-4 py-3 sticky top-0 z-[1000]">
        <div className={`${wide ? 'max-w-5xl' : 'max-w-md'} mx-auto flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center shrink-0">
              <Navigation size={15} className="fill-black text-black" />
            </span>
            <div className="min-w-0">
              <span className="text-sm font-extrabold tracking-tight block leading-tight">
                Orbit<span className="text-cyan-400">Ride</span> <span className="text-text-muted font-semibold">{title}</span>
              </span>
              {profile && <span className="text-[11px] text-text-muted block truncate leading-tight">{profile.full_name || profile.phone}</span>}
            </div>
          </div>
          <button
            onClick={() => void signOut()}
            className="btn-secondary px-2.5 py-1.5 text-[11px] gap-1.5 shrink-0"
            aria-label="Sign out"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </header>
      <main className={`flex-1 w-full ${wide ? 'max-w-5xl' : 'max-w-md'} mx-auto p-4 flex flex-col gap-4`}>{children}</main>
    </div>
  );
}

export function SuccessTick({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-4">
      <span className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center animate-map-reveal">
        <Check size={26} className="text-emerald-400" />
      </span>
      <span className="text-sm font-bold">{label}</span>
    </div>
  );
}
