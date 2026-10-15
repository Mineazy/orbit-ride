import React, { useState } from 'react';
import { api } from './api';
import { errorMessage } from './errors';
import { ErrorNote, Shell, Spinner, StatusPill, money, num } from './ui';
import { useLive } from './useLive';
import { ACTIVE_STATUSES, type DriverApproval, type DriverProfile, type FinanceSummary, type Profile, type Ride, type Withdrawal } from './types';

interface DriverRow extends DriverProfile { name: string; phone: string | null; balance: number }
interface AdminData {
  drivers: DriverRow[];
  rides: Ride[];
  counts: { passengers: number; completed: number; revenue: number };
  finance: FinanceSummary;
  withdrawals: (Withdrawal & { name: string })[];
  errors: { id: number; app: string; message: string; url: string | null; created_at: string }[];
}

// Record money a driver handed over outside the app (cash or bank transfer), settling fees they owe
function RecordPayment({ driverId, owed, onDone, onError }: { driverId: string; owed: number; onDone: () => Promise<void>; onError: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.recordPayment(driverId, value, 'Payment recorded by admin');
      setAmount('');
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder={owed > 0 ? `Owes ${money(owed)}` : 'Amount'} aria-label="Payment received"
        className="w-28 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/30"
      />
      <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy || !(value > 0)}>{busy ? '...' : 'Record payment'}</button>
    </form>
  );
}

export default function AdminHome() {
  const { data, loading, error, reload } = useLive<AdminData>(async (client) => {
    const [dp, pr, rides, accounts, wd, finance, errs] = await Promise.all([
      client.from('driver_profiles').select('*'),
      client.from('profiles').select('id, full_name, phone, role'),
      client.from('rides').select('*').order('requested_at', { ascending: false }).limit(50),
      client.from('ledger_accounts').select('owner, balance').eq('kind', 'user'),
      client.from('withdrawals').select('*').eq('status', 'requested').order('created_at', { ascending: true }),
      api.financeSummary(),
      client.from('client_errors').select('id, app, message, url, created_at').order('id', { ascending: false }).limit(15),
    ]);
    const balances = new Map(((accounts.data as { owner: string; balance: number | string }[] | null) ?? []).map(a => [a.owner, num(a.balance)]));
    const profiles = new Map(((pr.data as Profile[] | null) ?? []).map(p => [p.id, p]));
    const drivers = ((dp.data as DriverProfile[] | null) ?? []).map(d => ({
      ...d, name: profiles.get(d.id)?.full_name || 'Unnamed', phone: profiles.get(d.id)?.phone ?? null, balance: balances.get(d.id) ?? 0,
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
      finance,
      errors: (errs.data as AdminData['errors'] | null) ?? [],
      withdrawals: ((wd.data as Withdrawal[] | null) ?? []).map(w => ({ ...w, amount: num(w.amount), name: profiles.get(w.user_id)?.full_name || 'Driver' })),
    };
  }, [], ['rides', 'driver_profiles', 'ledger_accounts', 'withdrawals']);

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

  // An admin can end any live ride (a driver who vanished, a passenger who left). Money held for it is released.
  const cancelRide = async (id: string) => {
    setBusy(id);
    setActionError(null);
    try {
      await api.cancelRide(id, 'Cancelled by admin');
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (id: string, status: 'paid' | 'rejected') => {
    setBusy(id);
    setActionError(null);
    try {
      await api.resolveWithdrawal(id, status);
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
            <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Money</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                ['Fees earned', data.finance.platform_earned],
                ['Drivers owe', data.finance.drivers_owe],
                ['Owed to drivers', data.finance.owed_to_drivers],
                ['Paid out', data.finance.paid_out],
              ] as [string, number][]).map(([label, value]) => (
                <div key={label} className="glass-panel p-3">
                  <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider block">{label}</span>
                  <span className="text-lg font-black">{money(value)}</span>
                </div>
              ))}
            </div>
            {data.withdrawals.length === 0 ? (
              <p className="text-[11px] text-text-muted">No payout requests waiting.</p>
            ) : data.withdrawals.map(w => (
              <div key={w.id} className="glass-panel p-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold">{w.name} <span className="text-text-muted font-normal">asks for</span> {money(w.amount)}</p>
                <div className="flex gap-2">
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === w.id} onClick={() => void resolve(w.id, 'rejected')}>Reject</button>
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === w.id} onClick={() => void resolve(w.id, 'paid')}>Mark as paid</button>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-text-muted">Mark a payout as paid only after you have sent the bank transfer.</p>
          </section>

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
                    {d.balance !== 0 && <span className={d.balance < 0 ? 'text-amber-400' : 'text-emerald-400'}> · {d.balance < 0 ? `owes ${money(-d.balance)}` : `is owed ${money(d.balance)}`}</span>}
                  </p>
                  <div className="mt-2"><RecordPayment driverId={d.id} owed={d.balance < 0 ? -d.balance : 0} onDone={reload} onError={setActionError} /></div>
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
            <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">App errors (last 30 days)</h2>
            {data.errors.length === 0 ? (
              <p className="text-[11px] text-text-muted">No errors reported. Crashes in the apps show up here.</p>
            ) : data.errors.map(e => (
              <div key={e.id} className="glass-panel p-3 text-xs">
                <p className="font-semibold break-words">{e.message}</p>
                <p className="text-[11px] text-text-muted">{e.app} · {new Date(e.created_at).toLocaleString()}{e.url ? ` · ${e.url}` : ''}</p>
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
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <p className="text-xs font-bold">{money(r.fare)}</p>
                  <StatusPill status={r.status} />
                  {ACTIVE_STATUSES.includes(r.status) && (
                    <button className="text-[11px] text-danger underline" disabled={busy === r.id} onClick={() => void cancelRide(r.id)}>
                      {busy === r.id ? 'Cancelling...' : 'Cancel ride'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </Shell>
  );
}
