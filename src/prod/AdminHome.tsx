import React, { useState } from 'react';
import { api } from './api';
import { errorMessage } from './errors';
import { ErrorNote, Shell, Spinner, StatusPill, money, num } from './ui';
import { useLive } from './useLive';
import type { DriverApproval, DriverProfile, Profile, Ride } from './types';

interface DriverRow extends DriverProfile { name: string; phone: string | null }
interface AdminData { drivers: DriverRow[]; rides: Ride[]; counts: { passengers: number; completed: number; revenue: number } }

export default function AdminHome() {
  const { data, loading, error, reload } = useLive<AdminData>(async (client) => {
    const [dp, pr, rides] = await Promise.all([
      client.from('driver_profiles').select('*'),
      client.from('profiles').select('id, full_name, phone, role'),
      client.from('rides').select('*').order('requested_at', { ascending: false }).limit(50),
    ]);
    const profiles = new Map(((pr.data as Profile[] | null) ?? []).map(p => [p.id, p]));
    const drivers = ((dp.data as DriverProfile[] | null) ?? []).map(d => ({
      ...d, name: profiles.get(d.id)?.full_name || 'Unnamed', phone: profiles.get(d.id)?.phone ?? null,
    }));
    const all = (rides.data as Ride[] | null) ?? [];
    const done = all.filter(r => r.status === 'COMPLETED');
    return {
      drivers,
      rides: all,
      counts: {
        passengers: [...profiles.values()].filter(p => p.role === 'passenger').length,
        completed: done.length,
        revenue: done.reduce((s, r) => s + num(r.platform_fee), 0),
      },
    };
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (id: string, approval: DriverApproval) => {
    setBusy(id);
    setActionError(null);
    try {
      await api.setApproval(id, approval);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pending = data?.drivers.filter(d => d.approval === 'pending') ?? [];
  const others = data?.drivers.filter(d => d.approval !== 'pending') ?? [];

  return (
    <Shell title="Admin" wide>
      {loading && !data ? <Spinner /> : null}
      {error && !data ? <ErrorNote message={error} /> : null}
      <ErrorNote message={actionError} />
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Drivers', String(data.drivers.length)],
              ['Passengers', String(data.counts.passengers)],
              ['Completed rides', String(data.counts.completed)],
              ['Platform fees', money(data.counts.revenue)],
            ].map(([label, value]) => (
              <div key={label} className="glass-panel p-3">
                <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider block">{label}</span>
                <span className="text-xl font-black">{value}</span>
              </div>
            ))}
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Waiting for approval ({pending.length})</h2>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-4 text-center">
                <p className="text-xs font-bold">No applications waiting</p>
                <p className="text-[11px] text-text-muted mt-0.5">New driver applications appear here.</p>
              </div>
            ) : pending.map(d => (
              <div key={d.id} className="glass-panel p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{d.name} <span className="text-text-muted font-normal">{d.phone}</span></p>
                  <p className="text-[11px] text-text-muted">{d.vehicle} · <span className="font-mono">{d.plate}</span> · {d.tier}</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === d.id} onClick={() => void decide(d.id, 'rejected')}>Reject</button>
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === d.id} onClick={() => void decide(d.id, 'approved')}>Approve</button>
                </div>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Drivers ({others.length})</h2>
            {others.length === 0 ? (
              <p className="text-[11px] text-text-muted">No other drivers yet.</p>
            ) : others.map(d => (
              <div key={d.id} className="glass-panel p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{d.name} <span className="text-text-muted font-normal">{d.phone}</span></p>
                  <p className="text-[11px] text-text-muted">
                    {d.vehicle} · <span className="font-mono">{d.plate}</span> · {d.approval}{d.approval === 'approved' && d.is_online ? ' · online' : ''}
                  </p>
                </div>
                {d.approval === 'approved' ? (
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === d.id} onClick={() => void decide(d.id, 'suspended')}>Suspend</button>
                ) : (
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === d.id} onClick={() => void decide(d.id, 'approved')}>
                    {d.approval === 'suspended' ? 'Reinstate' : 'Approve'}
                  </button>
                )}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Latest rides</h2>
            {data.rides.length === 0 ? (
              <p className="text-[11px] text-text-muted">No rides yet.</p>
            ) : data.rides.slice(0, 20).map(r => (
              <div key={r.id} className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{r.pickup_name} → {r.dropoff_name}</p>
                  <p className="text-[11px] text-text-muted">{new Date(r.requested_at).toLocaleString()} · {r.tier}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold">{money(r.fare)}</p>
                  <StatusPill status={r.status} />
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </Shell>
  );
}
