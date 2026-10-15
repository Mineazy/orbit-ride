import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, MapPin, Navigation2, Star } from 'lucide-react';
import LazyMapView from '../components/LazyMapView';
import Avatar from '../components/Avatar';
import { MapDataContext } from '../context/MapDataContext';
import { VEHICLE_TIERS, WINDHOEK_LOCATIONS } from '../data/places';
import { routeDistance, roadsReady } from '../utils/routing';
import { useAuth } from './AuthContext';
import { api } from './api';
import { errorMessage } from './errors';
import { Elapsed, ErrorNote, InfoNote, Shell, Spinner, StatusPill, money, num } from './ui';
import { useLive } from './useLive';
import { calculateDistance } from '../utils/routing';
import { currentPosition } from './location';
import { fetchRoute, type ServerRoute } from './routeApi';
import { loadPlaceIndex, reverseGeocode, searchPlaces, type PlaceIndex } from '../utils/placeSearch';
import { useChangeAlert } from './notify';
import Wallet from './Wallet';
import AccountActions from './AccountActions';
import PushPrompt from './PushPrompt';
import { ACTIVE_STATUSES, type NearbyDriver, type PaymentMethod, type Ride, type Tier, type TierCount } from './types';

type LatLng = [number, number];
interface Place { name: string; coords: LatLng }

interface FareRow { tier: Tier; base_fare: number; per_km: number; min_fare: number }
interface Settings { surge_multiplier: number; wallet_enabled: boolean }
interface DriverInfo { name: string; avatar: string | null; vehicle: string; plate: string; rating: number | null; coords: LatLng | null; updatedAt: string | null }

interface PassengerData {
  ride: Ride | null;
  toRate: Ride | null;
  driver: DriverInfo | null;
  counts: TierCount[];
  history: Ride[];
  fares: FareRow[];
  surge: number;
  walletEnabled: boolean;
  walletAvailable: number;
}

const TIERS = Object.keys(VEHICLE_TIERS) as Tier[];

// Same formula as request_ride on the server, so the price shown is the price charged
const estimate = (tier: Tier, km: number, fares: FareRow[], surge: number): number | null => {
  const f = fares.find(x => x.tier === tier);
  if (!f || km <= 0) return null;
  return Math.max(num(f.min_fare), Math.round((num(f.base_fare) + num(f.per_km) * km) * surge * 100) / 100);
};

const STEPS = ['Requested', 'Driver on the way', 'Driver arrived', 'On trip'];
const stepIndex = (r: Ride) => ({ REQUESTED: 0, ACCEPTED: 1, ARRIVED: 2, IN_PROGRESS: 3, COMPLETED: 3, CANCELLED: 0 }[r.status]);

export default function PassengerHome() {
  const { userId } = useAuth();
  const { data, loading, error: loadError, reload } = useLive<PassengerData>(async (client) => {
    const active = await client.from('rides').select('*').eq('passenger_id', userId).in('status', ACTIVE_STATUSES).limit(1);
    const ride = ((active.data as Ride[] | null) ?? [])[0] ?? null;

    const unrated = await client.from('rides').select('*').eq('passenger_id', userId).eq('status', 'COMPLETED')
      .is('passenger_rating', null).order('completed_at', { ascending: false }).limit(1);
    const toRate = ((unrated.data as Ride[] | null) ?? [])[0] ?? null;

    const history = await client.from('rides').select('*').eq('passenger_id', userId).in('status', ['COMPLETED', 'CANCELLED'])
      .order('requested_at', { ascending: false }).limit(6);

    const withDriver = ride ?? toRate;
    let driver: DriverInfo | null = null;
    if (withDriver?.driver_id) {
      const [{ data: p }, { data: d }] = await Promise.all([
        client.from('profiles').select('full_name, avatar_url').eq('id', withDriver.driver_id).maybeSingle(),
        client.from('driver_profiles').select('vehicle, plate, rating, lat, lng, location_updated_at').eq('id', withDriver.driver_id).maybeSingle(),
      ]);
      if (p && d) {
        driver = {
          name: (p as { full_name: string }).full_name || 'Your driver',
          avatar: (p as { avatar_url: string | null }).avatar_url,
          vehicle: (d as { vehicle: string }).vehicle,
          plate: (d as { plate: string }).plate,
          rating: (d as { rating: number | null }).rating === null ? null : num((d as { rating: number }).rating),
          coords: (d as { lat: number | null }).lat === null ? null : [num((d as { lat: number }).lat), num((d as { lng: number }).lng)],
          updatedAt: (d as { location_updated_at: string | null }).location_updated_at,
        };
      }
    }

    const counts = await client.rpc('available_driver_counts');
    const fares = await client.from('fare_config').select('*');
    const settings = await client.from('platform_settings').select('*').maybeSingle();

    const walletInfo = await api.myWallet().catch(() => null);

    return {
      ride,
      toRate,
      driver,
      counts: (counts.data as TierCount[] | null) ?? [],
      history: (history.data as Ride[] | null) ?? [],
      fares: ((fares.data as FareRow[] | null) ?? []).map(f => ({ ...f, base_fare: num(f.base_fare), per_km: num(f.per_km), min_fare: num(f.min_fare) })),
      surge: num((settings.data as Settings | null)?.surge_multiplier) || 1,
      walletEnabled: !!(settings.data as Settings | null)?.wallet_enabled,
      walletAvailable: walletInfo?.available ?? 0,
    };
  }, [userId], ['rides', 'driver_profiles', 'ledger_accounts']);

  const alertKey = data?.ride ? `${data.ride.id}:${data.ride.status}` : data?.toRate ? `${data.toRate.id}:COMPLETED` : null;
  useChangeAlert(alertKey, (k) => {
    const status = k.split(':')[1];
    return ({
      ACCEPTED: { title: 'Driver on the way', body: 'A driver accepted your ride.' },
      ARRIVED: { title: 'Your driver has arrived', body: 'Meet them at your pickup point.' },
      IN_PROGRESS: { title: 'Trip started' },
      COMPLETED: { title: 'You have arrived', body: 'Rate your trip and pay if you have not already.' },
    } as Record<string, { title: string; body?: string }>)[status] ?? null;
  });

  return (
    <Shell title="Passenger">
      <PushPrompt role="passenger" />
      {loading && !data ? <Spinner /> : null}
      {loadError && !data ? <ErrorNote message={loadError} /> : null}
      {data && (data.ride
        ? <ActiveRide ride={data.ride} driver={data.driver} counts={data.counts} onChange={reload} />
        : data.toRate
          ? <RateRide ride={data.toRate} driver={data.driver} onChange={reload} />
          : <Booking data={data} onChange={reload} />)}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------------------------

function PlaceField({ label, dot, place, active, index, near, onActivate, onPick }: {
  label: string; dot: string; place: Place | null; active: boolean; index: PlaceIndex | null; near: LatLng | null;
  onActivate: () => void; onPick: (p: Place) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(
    () => (index ? searchPlaces(index, text, { near, limit: 8 }) : WINDHOEK_LOCATIONS.filter(l => l.name.toLowerCase().includes(text.toLowerCase())).map(l => ({ name: l.name, label: 'Landmark', coords: l.coords as LatLng, kind: 'landmark' }))),
    [index, text, near]
  );

  return (
    <div
      className={`rounded-xl border px-3 py-2 transition-all ${active ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5'}`}
      onClick={onActivate}
    >
      <label className="text-[10px] uppercase text-text-muted font-bold tracking-wider flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" /> {label}
        {active && <span className="text-cyan-400 normal-case font-semibold ml-auto">or tap the map</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          value={open ? text : place?.name ?? ''}
          placeholder="Search a place, street or suburb..."
          onFocus={() => { setOpen(true); setText(''); onActivate(); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setText(e.target.value)}
          className="bg-transparent border-none text-sm text-white font-semibold focus:outline-none w-full p-0 mt-0.5"
        />
        {open && (
          <div className="glass-panel absolute left-0 right-0 top-full mt-2 max-h-56 overflow-y-auto z-[2000] flex flex-col p-1">
            {text.trim().length < 2 && !matches.length ? (
              <span className="text-[11px] text-text-muted p-2">Type at least 2 letters, or tap the map to drop a pin.</span>
            ) : matches.length ? matches.map((l, i) => (
              <button
                key={`${l.name}-${i}`}
                type="button"
                onMouseDown={() => { onPick({ name: l.name, coords: l.coords }); setOpen(false); }}
                className="text-xs text-white hover:bg-white/5 px-2 py-2 rounded text-left flex items-baseline justify-between gap-2"
              >
                <span className="truncate">{l.name}</span>
                <span className="text-[10px] text-text-muted shrink-0">{l.label}</span>
              </button>
            )) : <span className="text-[11px] text-text-muted p-2">No match. Try another spelling, or tap the map to drop a pin.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Booking({ data, onChange }: { data: PassengerData; onChange: () => Promise<void> }) {
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');
  const [tier, setTier] = useState<Tier>('OrbitX');
  const [offer, setOffer] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [roadsLoaded, setRoadsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyDriver[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [index, setIndex] = useState<PlaceIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlaceIndex(new URL(`${import.meta.env.BASE_URL}tiles/windhoek-places.json`, window.location.href).href, WINDHOEK_LOCATIONS).then((i) => { if (!cancelled) setIndex(i); });
    return () => { cancelled = true; };
  }, []);

  // Available drivers around the pickup point, refreshed while the screen is open
  const pickupLat = pickup?.coords[0];
  const pickupLng = pickup?.coords[1];
  useEffect(() => {
    if (pickupLat === undefined || pickupLng === undefined) return;
    let cancelled = false;
    const fetchNearby = () => api.nearbyDrivers(pickupLat, pickupLng).then((d) => { if (!cancelled) setNearby(d); }).catch(() => {});
    void fetchNearby();
    const timer = setInterval(fetchNearby, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pickupLat, pickupLng]);

  useEffect(() => {
    let cancelled = false;
    roadsReady().then((r) => { if (r && !cancelled) setRoadsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // A quick estimate on the phone while the server answers; the server's signed distance replaces it
  const localKm = useMemo(
    () => (pickup && dropoff ? routeDistance(pickup.coords, dropoff.coords) : 0),
    // roadsLoaded: re-measure along streets once the road graph arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickup, dropoff, roadsLoaded]
  );
  const [serverRoute, setServerRoute] = useState<{ key: string; route: ServerRoute } | null>(null);
  const routeKey = pickup && dropoff ? `${pickup.coords.join(',')}|${dropoff.coords.join(',')}` : null;
  useEffect(() => {
    if (!pickup || !dropoff || !routeKey) return;
    let cancelled = false;
    fetchRoute(pickup.coords, dropoff.coords)
      .then((route) => { if (!cancelled) setServerRoute({ key: routeKey, route }); })
      .catch(() => { /* the estimate is shown; the request tries again and the server decides */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  const km = serverRoute && serverRoute.key === routeKey ? serverRoute.route.distance_km : localKm;
  const tooClose = !!pickup && !!dropoff && km < 0.06;
  const suggested = estimate(tier, km, data.fares, data.surge);
  const fare = offer ?? suggested;
  // With a pickup chosen, only drivers close enough to be offered the ride count
  const online = (t: Tier) => (pickup && nearby ? nearby.filter(d => d.tier === t).length : data.counts.find(c => c.tier === t)?.online_count ?? 0);

  const locateMe = async () => {
    setLocating(true);
    const pos = await currentPosition();
    setLocating(false);
    if (!pos) return setError('We could not get your location. Search for your pickup instead.');
    setError(null);
    setPickup({ name: (index ? reverseGeocode(index, pos) : null) ?? 'My location', coords: pos });
    setOffer(null);
    setActiveField('dropoff');
  };
  const mapDrivers = (pickup && nearby ? nearby : [])
    .filter(d => d.tier === tier)
    .map((d, i) => ({ id: `n${i}`, status: 'ONLINE_IDLE', coords: [d.lat, d.lng] as LatLng }));

  const onMapClick = (coords: LatLng, name?: string) => {
    const place = { name: name ?? (index ? reverseGeocode(index, coords) : null) ?? 'Pinned location', coords };
    if (activeField === 'pickup') { setPickup(place); setActiveField('dropoff'); } else setDropoff(place);
    setOffer(null);
  };

  const request = async () => {
    if (!pickup || !dropoff || !suggested) return;
    setBusy(true);
    setError(null);
    try {
      // get a fresh signed distance right before requesting (the earlier one may have expired)
      const route = await fetchRoute(pickup.coords, dropoff.coords).catch(() => null);
      const from = route?.pickup ?? pickup.coords;
      const to = route?.dropoff ?? dropoff.coords;
      await api.requestRide({
        pickupName: pickup.name, pickupLat: from[0], pickupLng: from[1],
        dropoffName: dropoff.name, dropoffLat: to[0], dropoffLng: to[1],
        tier, distanceKm: route?.distance_km ?? km, offer: offer !== null && offer !== suggested ? offer : null, paymentMethod: payment,
        routeExp: route?.exp ?? null, routeSig: route?.sig ?? null,
      });
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fitPoints = pickup && dropoff ? [pickup.coords, dropoff.coords] : pickup ? [pickup.coords] : dropoff ? [dropoff.coords] : null;

  return (
    <>
      <div className="relative rounded-2xl overflow-hidden border border-white/5 shrink-0" style={{ height: 220 }}>
        <MapDataContext.Provider value={{ drivers: mapDrivers, passenger: null, rides: [] }}>
          <LazyMapView
            height="100%" width="100%" showLocations zoomControl={false}
            onMapClick={onMapClick}
            customPickupCoords={pickup?.coords ?? null} customDropoffCoords={dropoff?.coords ?? null}
            fitPoints={fitPoints}
          />
        </MapDataContext.Provider>
      </div>

      <button type="button" onClick={() => void locateMe()} disabled={locating} className="btn-secondary w-full py-2 text-xs justify-center gap-1.5">
        <Navigation2 size={13} /> {locating ? 'Finding you...' : 'Use my location as pickup'}
      </button>

      <div className="glass-panel p-3 flex flex-col gap-2">
        <PlaceField label="Pickup" dot="bg-cyan-400" place={pickup} index={index} near={dropoff?.coords ?? null} active={activeField === 'pickup'} onActivate={() => setActiveField('pickup')} onPick={(p) => { setPickup(p); setOffer(null); setActiveField('dropoff'); }} />
        <PlaceField label="Dropoff" dot="bg-pink-500" place={dropoff} index={index} near={pickup?.coords ?? null} active={activeField === 'dropoff'} onActivate={() => setActiveField('dropoff')} onPick={(p) => { setDropoff(p); setOffer(null); }} />
      </div>

      {tooClose && <ErrorNote message="Pickup and dropoff are too close together. Choose a different destination." />}

      <div>
        <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Choose a ride</span>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {TIERS.map(t => {
            const price = estimate(t, km, data.fares, data.surge);
            const n = online(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                onClick={() => { setTier(t); setOffer(null); }}
                className={`rounded-xl p-2.5 flex flex-col items-center gap-0.5 border transition-all active:scale-95 ${tier === t ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5'}`}
              >
                <Navigation2 size={16} className={tier === t ? 'text-cyan-400' : 'text-text-muted'} />
                <span className="text-xs font-bold">{VEHICLE_TIERS[t].name}</span>
                <span className="text-[10px] text-text-muted truncate max-w-full">{VEHICLE_TIERS[t].label}</span>
                <span className="text-xs font-extrabold text-cyan-300 mt-1">{price ? money(price) : '-'}</span>
                <span className={`text-[10px] ${n > 0 ? 'text-text-muted' : 'text-amber-400'}`}>{n > 0 ? `${n} online` : 'No drivers'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {online(tier) === 0 && (
        <InfoNote tone="warn">
          No {tier} drivers are {pickup ? 'near your pickup' : 'online'} right now. You can still request a ride and we will keep looking.
        </InfoNote>
      )}

      {suggested && fare && (
        <div className="glass-panel p-3 flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase font-bold text-cyan-400 tracking-wider block">Your offer</span>
            <span className="text-[11px] text-text-muted">Suggested {money(suggested)} · {km.toFixed(1)} km</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Decrease offer" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 font-bold text-lg" onClick={() => setOffer(Math.max(1, Math.round((fare - 1) * 100) / 100))}>-</button>
            <span className="text-lg font-black font-mono w-20 text-center">{money(fare)}</span>
            <button type="button" aria-label="Increase offer" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 font-bold text-lg" onClick={() => setOffer(Math.round((fare + 1) * 100) / 100)}>+</button>
          </div>
        </div>
      )}

      {data.walletEnabled && fare && (
        <div role="radiogroup" aria-label="How will you pay?" className="grid grid-cols-2 gap-2">
          {(['cash', 'wallet'] as PaymentMethod[]).map(m => {
            const short = m === 'wallet' && data.walletAvailable < fare;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={payment === m}
                disabled={short}
                onClick={() => setPayment(m)}
                className={`rounded-xl p-2.5 text-left border transition-all disabled:opacity-50 ${payment === m ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5'}`}
              >
                <span className="text-xs font-bold block">{m === 'cash' ? 'Cash' : 'Wallet'}</span>
                <span className="text-[10px] text-text-muted">{m === 'cash' ? 'Pay the driver' : short ? `${money(data.walletAvailable)}, top up below` : money(data.walletAvailable)}</span>
              </button>
            );
          })}
        </div>
      )}

      <ErrorNote message={error} />

      <button
        onClick={() => void request()}
        disabled={busy || !pickup || !dropoff || tooClose || !suggested}
        className="btn-primary w-full py-3.5 justify-center text-sm tracking-wide"
      >
        {busy ? 'REQUESTING...' : !pickup || !dropoff ? 'CHOOSE PICKUP AND DROPOFF' : tooClose ? 'PICK A DIFFERENT DROPOFF' : `REQUEST ${tier.toUpperCase()} · ${money(fare)}`}
      </button>

      <p className="text-[11px] text-text-muted flex items-center gap-1.5 justify-center">
        <Banknote size={13} /> {payment === 'wallet' ? 'The fare is taken from your wallet when the trip ends.' : 'You pay the driver in cash at the end of the trip.'}
      </p>

      <Wallet role="passenger" />
      <History rides={data.history} />
      <AccountActions />
    </>
  );
}

function History({ rides }: { rides: Ride[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Recent rides</h2>
      {rides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-4 text-center">
          <p className="text-xs font-bold">No rides yet</p>
          <p className="text-[11px] text-text-muted mt-0.5">Your completed and cancelled rides will show up here.</p>
        </div>
      ) : rides.map(r => (
        <div key={r.id} className="glass-panel p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{r.pickup_name} → {r.dropoff_name}</p>
            <p className="text-[11px] text-text-muted">{new Date(r.requested_at).toLocaleDateString()} · {r.tier}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-bold">{r.status === 'COMPLETED' ? money(r.fare) : '-'}</p>
            <StatusPill status={r.status} />
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// A ride in progress
// ---------------------------------------------------------------------------------------------

// Tells the passenger when the car on the map is out of date (the driver's phone stopped reporting)
function StaleLocation({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor((now - new Date(since).getTime()) / 60000);
  if (mins < 2) return null;
  return <InfoNote tone="warn">Your driver's location was last updated {mins} min ago, so the car on the map may not be where they are now.</InfoNote>;
}

function ActiveRide({ ride, driver, counts, onChange }: { ride: Ride; driver: DriverInfo | null; counts: TierCount[]; onChange: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = stepIndex(ride);
  const canCancel = ride.status !== 'IN_PROGRESS';
  const online = counts.find(c => c.tier === ride.tier)?.online_count ?? 0;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelRide(ride.id, 'Cancelled by passenger');
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const mapData = { drivers: driver?.coords ? [{ id: 'assigned', status: 'ON_TRIP', coords: driver.coords }] : [], passenger: null, rides: [] };

  // Rough arrival estimate from the driver's last position (straight line at city speed)
  const target: LatLng | null = ride.status === 'ACCEPTED' ? [num(ride.pickup_lat), num(ride.pickup_lng)]
    : ride.status === 'IN_PROGRESS' ? [num(ride.dropoff_lat), num(ride.dropoff_lng)] : null;
  const away = driver?.coords && target ? calculateDistance(driver.coords, target) : null;
  const etaMin = away === null ? null : Math.max(1, Math.round((away * 1.3 / 30) * 60));

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={ride.status} />
        <span className="text-xs font-mono text-text-muted" title="Time since you requested">
          <Elapsed since={ride.requested_at} />
        </span>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/5 shrink-0" style={{ height: 220 }}>
        <MapDataContext.Provider value={mapData}>
          <LazyMapView
            height="100%" width="100%" showLocations={false} zoomControl={false}
            customPickupCoords={[num(ride.pickup_lat), num(ride.pickup_lng)]} customDropoffCoords={[num(ride.dropoff_lat), num(ride.dropoff_lng)]}
            fitPoints={[[num(ride.pickup_lat), num(ride.pickup_lng)], [num(ride.dropoff_lat), num(ride.dropoff_lng)], ...(driver?.coords ? [driver.coords] : [])]}
          />
        </MapDataContext.Provider>
      </div>

      <ol className="grid grid-cols-4 gap-1.5" aria-label="Ride progress">
        {STEPS.map((label, i) => (
          <li key={label}>
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-cyan-400' : 'bg-white/10'}`} />
            <span className={`text-[10px] mt-1 block leading-tight ${i === step ? 'text-cyan-400 font-bold' : 'text-text-muted'}`}>{label}</span>
          </li>
        ))}
      </ol>

      {ride.status === 'REQUESTED' ? (
        <div className="glass-panel p-4 text-center flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center pulse-glowing-cyan">
            <Navigation2 size={24} className="text-cyan-400" />
          </span>
          <div>
            <h2 className="text-base font-bold">Finding your driver</h2>
            <p className="text-xs text-text-muted mt-1">Sending your request to nearby {ride.tier} drivers.</p>
          </div>
          {online === 0 && (
            <InfoNote tone="warn">No {ride.tier} drivers are online right now. You can keep waiting, or cancel and try another ride type.</InfoNote>
          )}
        </div>
      ) : (
        <div className="glass-panel p-3 flex items-center gap-3">
          <Avatar src={driver?.avatar} name={driver?.name ?? ''} className="w-12 h-12 rounded-full border border-white/10" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{driver?.name ?? 'Your driver'}</p>
            <p className="text-[11px] text-text-muted flex items-center gap-1">
              <Star size={11} className="fill-amber-400 text-amber-400" />
              {driver?.rating === null || driver?.rating === undefined ? 'New driver' : driver.rating.toFixed(2)}
              {driver && <span className="truncate">· {driver.vehicle}</span>}
            </p>
          </div>
          {driver && <span className="px-2 py-1 rounded-lg bg-black/20 border border-white/10 text-xs font-mono font-bold">{driver.plate}</span>}
        </div>
      )}
      {etaMin !== null && away !== null && (
        <p className="text-xs text-center text-text-muted">
          {ride.status === 'ACCEPTED' ? 'Arriving' : 'Arriving at your destination'} in about <b className="text-white">{etaMin} min</b> · {away.toFixed(1)} km away
        </p>
      )}
      {ride.status !== 'REQUESTED' && driver?.updatedAt && <StaleLocation since={driver.updatedAt} />}

      <div className="glass-panel p-3 flex flex-col gap-2 text-xs">
        <div className="flex gap-2 min-w-0"><MapPin size={14} className="text-cyan-400 shrink-0" /><span className="truncate">{ride.pickup_name}</span></div>
        <div className="flex gap-2 min-w-0"><MapPin size={14} className="text-pink-500 shrink-0" /><span className="truncate">{ride.dropoff_name}</span></div>
        <div className="flex justify-between border-t border-white/5 pt-2 mt-1">
          <span className="text-text-muted flex items-center gap-1.5"><Banknote size={13} /> {ride.payment_method === 'wallet' ? 'Paid from your wallet' : 'Pay the driver in cash'}</span>
          <span className="font-extrabold text-cyan-300">{money(ride.fare)}</span>
        </div>
      </div>

      <ErrorNote message={error} />

      {canCancel && (
        confirming ? (
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 py-2.5 text-xs justify-center" onClick={() => setConfirming(false)} disabled={busy}>Keep my ride</button>
            <button className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-danger/20 text-danger border border-danger/30" onClick={() => void cancel()} disabled={busy}>
              {busy ? 'Cancelling...' : 'Yes, cancel'}
            </button>
          </div>
        ) : (
          <button className="btn-secondary w-full py-2.5 text-xs text-danger border-danger/25 justify-center" onClick={() => setConfirming(true)}>
            Cancel ride
          </button>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Rate the driver after a completed ride
// ---------------------------------------------------------------------------------------------

function RateRide({ ride, driver, onChange }: { ride: Ride; driver: DriverInfo | null; onChange: () => Promise<void> }) {
  const [stars, setStars] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.rateDriver(ride.id, stars);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="text-center pt-2">
        <span className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto mb-2">
          <AlertTriangle size={0} />
          <Star size={26} className="fill-emerald-400 text-emerald-400" />
        </span>
        <h2 className="text-lg font-bold">You have arrived</h2>
        <p className="text-xs text-text-muted truncate px-6">{ride.dropoff_name}</p>
      </div>

      <div className="glass-panel p-3 flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between"><span className="text-text-muted">{ride.tier} · {num(ride.distance_km)} km</span><span className="font-semibold">{money(ride.fare)}</span></div>
        <div className="flex justify-between border-t border-white/5 pt-2 mt-1">
          <span className="font-bold">{ride.payment_method === 'wallet' ? 'Paid from your wallet' : 'Pay the driver (cash)'}</span>
          <span className="text-base font-extrabold text-emerald-400">{money(ride.fare)}</span>
        </div>
      </div>

      <div className="glass-panel p-4 text-center">
        <Avatar src={driver?.avatar} name={driver?.name ?? ''} className="w-12 h-12 rounded-full border border-white/10 mx-auto" />
        <p className="text-sm font-bold mt-2">How was your ride{driver ? ` with ${driver.name}` : ''}?</p>
        <div className="flex justify-center gap-1.5 mt-2" role="radiogroup" aria-label="Rate your driver">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" role="radio" aria-checked={n === stars} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(n)} className="p-0.5 active:scale-90">
              <Star size={30} className={n <= stars ? 'fill-amber-400 text-amber-400' : 'text-text-muted'} />
            </button>
          ))}
        </div>
        <p className="text-xs font-bold text-amber-400 mt-1 h-4">{labels[stars]}</p>
      </div>

      <ErrorNote message={error} />
      <button className="btn-primary w-full py-3 justify-center text-sm" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Submitting...' : 'Submit rating'}
      </button>
    </>
  );
}
