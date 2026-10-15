import React, { useState } from 'react';
import { Banknote, MapPin, Star } from 'lucide-react';
import { VEHICLE_TIERS } from '../data/places';
import { useAuth } from './AuthContext';
import { api } from './api';
import { errorMessage } from './errors';
import { Elapsed, ErrorNote, InfoNote, Shell, Spinner, StatusPill, money, num } from './ui';
import { useLive } from './useLive';
import Wallet from './Wallet';
import AccountActions from './AccountActions';
import { GPS_MESSAGES, useDriverTracking } from './location';
import { askNotificationPermission, useChangeAlert } from './notify';
import { calculateDistance } from '../utils/routing';
import { ACTIVE_STATUSES, type DriverProfile, type Ride, type Tier } from './types';

const TIERS = Object.keys(VEHICLE_TIERS) as Tier[];

interface DriverData {
  me: DriverProfile | null;
  open: Ride[];
  current: Ride | null;
  passenger: string | null;
  recent: Ride[];
}

const fieldClass =
  'w-full bg-black/30 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/60 transition-colors';

export default function DriverHome() {
  const { userId } = useAuth();
  const { data, loading, error, reload } = useLive<DriverData>(async (client) => {
    const { data: me } = await client.from('driver_profiles').select('*').eq('id', userId).maybeSingle();
    if (!me) return { me: null, open: [], current: null, passenger: null, recent: [] };

    const mine = me as DriverProfile;
    const cur = await client.from('rides').select('*').eq('driver_id', userId).in('status', ACTIVE_STATUSES).limit(1);
    const current = ((cur.data as Ride[] | null) ?? [])[0] ?? null;

    let open: Ride[] = [];
    if (!current && mine.approval === 'approved' && mine.is_online) {
      const o = await client.from('rides').select('*').eq('status', 'REQUESTED').eq('tier', mine.tier).order('requested_at', { ascending: true }).limit(10);
      open = (o.data as Ride[] | null) ?? [];
    }

    let passenger: string | null = null;
    if (current) {
      const { data: p } = await client.from('profiles').select('full_name').eq('id', current.passenger_id).maybeSingle();
      passenger = (p as { full_name: string } | null)?.full_name || 'Passenger';
    }

    const rec = await client.from('rides').select('*').eq('driver_id', userId).eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false }).limit(5);

    return { me: mine, open, current, passenger, recent: (rec.data as Ride[] | null) ?? [] };
  }, [userId]);

  return (
    <Shell title="Driver">
      {loading && !data ? <Spinner /> : null}
      {error && !data ? <ErrorNote message={error} /> : null}
      {data && (!data.me ? <Register onDone={reload} /> : data.me.approval !== 'approved' ? <Waiting me={data.me} /> : <Console data={data} me={data.me} onChange={reload} />)}
    </Shell>
  );
}

function Register({ onDone }: { onDone: () => Promise<void> }) {
  const [vehicle, setVehicle] = useState('');
  const [plate, setPlate] = useState('');
  const [tier, setTier] = useState<Tier>('OrbitX');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.registerDriver(vehicle.trim(), plate.trim().toUpperCase(), tier);
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Become an OrbitRide driver</h2>
        <p className="text-xs text-text-muted mt-1">Tell us about your vehicle. We review every application before you can go online.</p>
      </div>
      <label className="flex flex-col gap-1.5 text-[11px] text-text-muted uppercase font-bold tracking-wider">
        Vehicle
        <input className={fieldClass} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. Toyota Corolla, white" />
      </label>
      <label className="flex flex-col gap-1.5 text-[11px] text-text-muted uppercase font-bold tracking-wider">
        Number plate
        <input className={fieldClass} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="e.g. N 1234 W" />
      </label>
      <div>
        <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Ride type</span>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {TIERS.map(t => (
            <button key={t} type="button" aria-pressed={tier === t} onClick={() => setTier(t)}
              className={`rounded-xl p-2.5 border text-center transition-all ${tier === t ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5'}`}>
              <span className="text-xs font-bold block">{VEHICLE_TIERS[t].name}</span>
              <span className="text-[10px] text-text-muted">{VEHICLE_TIERS[t].label}</span>
            </button>
          ))}
        </div>
      </div>
      <ErrorNote message={error} />
      <button className="btn-primary w-full py-3 justify-center text-sm" disabled={busy || vehicle.trim().length < 2 || plate.trim().length < 2}>
        {busy ? 'Submitting...' : 'Submit application'}
      </button>
    </form>
  );
}

function Waiting({ me }: { me: DriverProfile }) {
  const text: Record<string, { title: string; body: string; tone: 'info' | 'warn' }> = {
    pending: { title: 'Application under review', body: 'We are checking your details. This page updates by itself as soon as you are approved.', tone: 'info' },
    rejected: { title: 'Application not approved', body: 'We could not approve this application. Contact support if you think this is a mistake.', tone: 'warn' },
    suspended: { title: 'Account suspended', body: 'Your driver account is suspended. Contact support to find out why.', tone: 'warn' },
  };
  const t = text[me.approval];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="text-center">
        <h2 className="text-lg font-bold">{t.title}</h2>
      </div>
      <InfoNote tone={t.tone}>{t.body}</InfoNote>
      <div className="glass-panel p-3 text-xs flex justify-between">
        <span>{me.vehicle}</span>
        <span className="font-mono font-bold">{me.plate}</span>
      </div>
      <AccountActions />
    </div>
  );
}

function Console({ data, me, onChange }: { data: DriverData; me: DriverProfile; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
      await onChange(); // the ride may have been taken or cancelled: show the fresh state
    } finally {
      setBusy(null);
    }
  };

  const toggleOnline = () => {
    if (!me.is_online) askNotificationPermission();
    return run('online', () => api.setOnline(!me.is_online));
  };

  // Share our position while online; requests near us only show up once the server has a fresh position
  const gps = useDriverTracking(me.is_online);
  const here: [number, number] | null = me.lat !== null && me.lng !== null ? [num(me.lat), num(me.lng)] : null;
  const km = (r: Ride) => (here ? calculateDistance(here, [num(r.pickup_lat), num(r.pickup_lng)]) : null);
  const open = [...data.open].sort((a, b) => (km(a) ?? 0) - (km(b) ?? 0));

  useChangeAlert(open.length ? open[open.length - 1].id : null, () => ({ title: 'New ride request', body: 'A passenger nearby needs a ride.' }));

  const { current } = data;

  return (
    <>
      <div className="glass-panel p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{me.vehicle} · <span className="font-mono">{me.plate}</span></p>
          <p className="text-[11px] text-text-muted flex items-center gap-1">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {me.rating === null ? 'No ratings yet' : `${num(me.rating).toFixed(2)} (${me.rating_count})`} · {VEHICLE_TIERS[me.tier].name}
          </p>
        </div>
        <button
          onClick={() => void toggleOnline()}
          disabled={busy !== null || !!current}
          aria-pressed={me.is_online}
          className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${me.is_online ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'bg-white/5 border-white/10 text-text-muted'}`}
        >
          {busy === 'online' ? '...' : me.is_online ? 'Online' : 'Offline'}
        </button>
      </div>

      <ErrorNote message={error} />
      {me.is_online && GPS_MESSAGES[gps] && <InfoNote tone={gps === 'waiting' ? 'info' : 'warn'}>{GPS_MESSAGES[gps]}</InfoNote>}

      {current ? (
        <CurrentRide ride={current} passenger={data.passenger} busy={busy} run={run} />
      ) : !me.is_online ? (
        <InfoNote>You are offline. Go online to start receiving ride requests.</InfoNote>
      ) : open.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
          <p className="text-sm font-bold">Waiting for requests</p>
          <p className="text-[11px] text-text-muted mt-1">New {me.tier} requests within a few kilometres of you appear here.</p>
        </div>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Open requests</h2>
          {open.map(r => (
            <div key={r.id} className="glass-panel p-3 flex flex-col gap-2">
              <div className="text-xs flex flex-col gap-1">
                <span className="flex gap-2 min-w-0"><MapPin size={14} className="text-cyan-400 shrink-0" /><span className="truncate">{r.pickup_name}</span></span>
                <span className="flex gap-2 min-w-0"><MapPin size={14} className="text-pink-500 shrink-0" /><span className="truncate">{r.dropoff_name}</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted">
                  {km(r) !== null ? `${km(r)!.toFixed(1)} km away · ` : ''}{num(r.distance_km).toFixed(1)} km trip · waiting <Elapsed since={r.requested_at} />
                </span>
                <span className="text-sm font-extrabold text-cyan-300">{money(r.fare)}<span className="text-[10px] text-text-muted font-semibold ml-1">{r.payment_method === 'wallet' ? 'wallet' : 'cash'}</span></span>
              </div>
              <button className="btn-primary w-full py-2.5 text-xs justify-center" disabled={busy !== null} onClick={() => void run(r.id, () => api.acceptRide(r.id))}>
                {busy === r.id ? 'Accepting...' : 'Accept ride'}
              </button>
            </div>
          ))}
        </section>
      )}

      <Wallet role="driver" />

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Recent trips</h2>
        {data.recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-4 text-center">
            <p className="text-xs font-bold">No trips yet</p>
            <p className="text-[11px] text-text-muted mt-0.5">Completed trips and your earnings show up here.</p>
          </div>
        ) : data.recent.map(r => (
          <div key={r.id} className="glass-panel p-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold truncate min-w-0">{r.pickup_name} → {r.dropoff_name}</p>
            <span className="text-xs font-bold text-emerald-400 shrink-0">{money(r.driver_payout)}</span>
          </div>
        ))}
      </section>
      <AccountActions />
    </>
  );
}

function CurrentRide({ ride, passenger, busy, run }: {
  ride: Ride; passenger: string | null; busy: string | null; run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const next = {
    ACCEPTED: { label: 'I have arrived', fn: () => api.markArrived(ride.id) },
    ARRIVED: { label: 'Start trip', fn: () => api.startTrip(ride.id) },
    IN_PROGRESS: { label: 'Complete trip', fn: () => api.completeTrip(ride.id) },
  }[ride.status as 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS'];
  const heading = ride.status === 'IN_PROGRESS' ? ride.dropoff_name : ride.pickup_name;

  return (
    <div className="glass-panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <StatusPill status={ride.status} />
        <span className="text-xs text-text-muted">{passenger}</span>
      </div>
      <div className="text-xs flex flex-col gap-1.5">
        <span className="flex gap-2 min-w-0"><MapPin size={14} className="text-cyan-400 shrink-0" /><span className="truncate">{ride.pickup_name}</span></span>
        <span className="flex gap-2 min-w-0"><MapPin size={14} className="text-pink-500 shrink-0" /><span className="truncate">{ride.dropoff_name}</span></span>
      </div>
      <p className="text-[11px] text-text-muted">Head to: <b className="text-white">{heading}</b></p>
      <div className="flex justify-between border-t border-white/5 pt-2 text-xs">
        <span className="text-text-muted flex items-center gap-1.5"><Banknote size={13} /> {ride.payment_method === 'wallet' ? 'Paid from passenger wallet' : 'Collect in cash'}</span>
        <span className="font-extrabold text-cyan-300">{money(ride.fare)}</span>
      </div>
      {next && (
        <button className="btn-primary w-full py-3 justify-center text-sm" disabled={busy !== null} onClick={() => void run('step', next.fn)}>
          {busy === 'step' ? '...' : next.label}
        </button>
      )}
      {ride.status === 'ACCEPTED' && (
        <button className="btn-secondary w-full py-2 text-xs justify-center" disabled={busy !== null} onClick={() => void run('release', () => api.releaseRide(ride.id))}>
          Give this ride back
        </button>
      )}
    </div>
  );
}
