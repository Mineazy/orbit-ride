// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS, VEHICLE_TIERS, routeDistance, roadsReady } from '../context/SimulationContext';
import { 
  Navigation2, Star, CreditCard, AlertTriangle,
  ShieldCheck, Clock, CheckCircle2,
  Wallet, QrCode, Phone, X, Check, Loader2
} from 'lucide-react';
import MapView from './LazyMapView';
import Avatar from './Avatar';
import { polylineLength } from '../utils/roadRouter';

// Shown when a search drags on: explains the likely reason instead of leaving the passenger staring at a timer
function SearchingNote({ since, tier, onlineCount }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (Math.floor((now - since) / 1000) < 20) return null;
  return (
    <div role="status" className="w-full rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-left flex gap-2.5">
      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-amber-300 leading-relaxed">
        {onlineCount === 0
          ? `No ${tier} drivers are online right now. You can keep waiting, or cancel and try another ride type.`
          : 'This is taking longer than usual. Nearby drivers may be busy. You can keep waiting or cancel.'}
      </p>
    </div>
  );
}

// Live m:ss counter since a timestamp (used while searching for a driver)
function ElapsedTimer({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  return <span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>;
}

// Helper to resolve coordinates for any address input
const resolveCoordinatesForAddress = (address) => {
  if (!address || address.trim() === '') return [-22.5615, 17.0835]; // fallback Windhoek CBD

  // 1. Try to find a exact or partial match in WINDHOEK_LOCATIONS
  const match = WINDHOEK_LOCATIONS.find(l => 
    l.name.toLowerCase().includes(address.toLowerCase()) || 
    address.toLowerCase().includes(l.name.toLowerCase())
  );
  if (match) return match.coords;

  // 2. Fallback: Generate a deterministic coordinate offset from Windhoek CBD [-22.5615, 17.0835]
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Offset range: -0.015 to +0.015
  const latOffset = ((hash % 150) / 10000); 
  const lonOffset = (((hash >> 8) % 150) / 10000);
  return [-22.5615 + latOffset, 17.0835 + lonOffset];
};

export default function ClientApp() {
  const {
    passenger,
    rides,
    requestRide,
    cancelRide,
    submitRating,
    drivers,
    weather,
    surgeMultiplier,
    topUpPassengerBalance
  } = useSimulation();

  // Screen states
  const [selectedTier, setSelectedTier] = useState('OrbitX');
  
  // Custom Selection States
  const [customPickupCoords, setCustomPickupCoords] = useState([-22.5615, 17.0835]);
  const [customDropoffCoords, setCustomDropoffCoords] = useState([-22.6120, 17.0795]);
  const [customPickupName, setCustomPickupName] = useState('Windhoek CBD (Independence Ave)');
  const [customDropoffName, setCustomDropoffName] = useState('Eros Airport (ERS)');
  const [activeSelectionField, setActiveSelectionField] = useState('pickup'); // pickup | dropoff

  // Rating states upon completion
  const [givenRating, setGivenRating] = useState(5);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const [offerFare, setOfferFare] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState(null);

  // Payment Gateway states
  const [isPaymentHubOpen, setIsPaymentHubOpen] = useState(false);
  const [paymentStep, setPaymentStep] = useState('hub'); // hub | topup | gateway_input | 3ds | processing | success
  const [selectedGateway, setSelectedGateway] = useState('dpo_card'); // dpo_card | dpo_mobile | paytoday
  const [topUpAmount, setTopUpAmount] = useState(100);
  const [activePaymentMethod, setActivePaymentMethod] = useState('wallet'); // wallet | dpo_card | dpo_mobile | paytoday

  // Gateway form fields
  const [cardNo, setCardNo] = useState('4111 2222 3333 4444');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCVV, setCardCVV] = useState('123');
  const [cardOTP, setCardOTP] = useState('123456');
  const [mobileNo, setMobileNo] = useState('+264 81 234 5678');
  const [mobileProvider, setMobileProvider] = useState('M-Pesa');

  // Map Click Handler for Dropping Custom Pins and Selecting Locations
  const handleMapClick = (coords, name = null) => {
    const defaultPickupName = name || `Pin at (${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})`;
    const defaultDropoffName = name || `Pin at (${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})`;
    if (activeSelectionField === 'pickup') {
      setCustomPickupCoords(coords);
      setCustomPickupName(defaultPickupName);
      setPickupSearch(defaultPickupName);
    } else {
      setCustomDropoffCoords(coords);
      setCustomDropoffName(defaultDropoffName);
      setDropoffSearch(defaultDropoffName);
    }
  };

  // Helper to retrieve active coordinates
  const getSelectedCoords = (type) => {
    if (type === 'pickup') {
      return customPickupCoords;
    } else {
      return customDropoffCoords;
    }
  };

  // Helper to retrieve active names
  const getSelectedName = (type) => {
    if (type === 'pickup') {
      return customPickupName;
    } else {
      return customDropoffName;
    }
  };

  // Search Autocomplete States
  const [pickupSearch, setPickupSearch] = useState('Windhoek CBD (Independence Ave)');
  const [dropoffSearch, setDropoffSearch] = useState('Eros Airport (ERS)');
  const [isPickupFocused, setIsPickupFocused] = useState(false);
  const [isDropoffFocused, setIsDropoffFocused] = useState(false);

  // Sync inputs when not focused
  useEffect(() => {
    if (!isPickupFocused) {
      setPickupSearch(customPickupName);
    }
  }, [customPickupName, isPickupFocused]);

  useEffect(() => {
    if (!isDropoffFocused) {
      setDropoffSearch(customDropoffName);
    }
  }, [customDropoffName, isDropoffFocused]);

  // Geocode pickup when text changes
  useEffect(() => {
    if (isPickupFocused && pickupSearch.trim()) {
      const coords = resolveCoordinatesForAddress(pickupSearch);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- geocode as the user types
      setCustomPickupCoords(coords);
      setCustomPickupName(pickupSearch);
    }
  }, [pickupSearch, isPickupFocused]);

  // Geocode dropoff when text changes
  useEffect(() => {
    if (isDropoffFocused && dropoffSearch.trim()) {
      const coords = resolveCoordinatesForAddress(dropoffSearch);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- geocode as the user types
      setCustomDropoffCoords(coords);
      setCustomDropoffName(dropoffSearch);
    }
  }, [dropoffSearch, isDropoffFocused]);

  const filteredPickupLocations = WINDHOEK_LOCATIONS.filter(loc => 
    loc.name.toLowerCase().includes(pickupSearch.toLowerCase())
  );

  const filteredDropoffLocations = WINDHOEK_LOCATIONS.filter(loc => 
    loc.name.toLowerCase().includes(dropoffSearch.toLowerCase())
  );

  // Find active ride associated with passenger
  const activeRide = rides.find(r => r.id === passenger.activeRideId);
  const activeDriver = activeRide ? drivers.find(d => d.id === activeRide.driverId) : null;

  // completeTrip clears passenger.activeRideId, so remember the ride that just left the active slot and,
  // once it is COMPLETED, show its receipt + review. State is adjusted during render (React's derived-state
  // pattern) rather than in an effect.
  const [prevActiveRideId, setPrevActiveRideId] = useState(passenger.activeRideId);
  const [watchRideId, setWatchRideId] = useState(null);
  const [reviewRideId, setReviewRideId] = useState(null);
  if (passenger.activeRideId !== prevActiveRideId) {
    setPrevActiveRideId(passenger.activeRideId);
    if (prevActiveRideId && !passenger.activeRideId) setWatchRideId(prevActiveRideId);
  }
  const watchedRide = watchRideId ? rides.find(r => r.id === watchRideId) : null;
  if (watchedRide && watchedRide.status === 'COMPLETED') {
    setWatchRideId(null);
    setReviewRideId(watchedRide.id);
    setGivenRating(5);
    setRatingSubmitted(false);
  } else if (watchedRide && watchedRide.status === 'CANCELLED') {
    setWatchRideId(null);
  }
  const reviewRide = reviewRideId ? rides.find(r => r.id === reviewRideId) : null;
  const reviewDriver = reviewRide ? drivers.find(d => d.id === reviewRide.driverId) : null;
  const dismissReview = () => {
    setReviewRideId(null);
    setRatingSubmitted(false);
    setGivenRating(5);
  };
  
  const calculateFareEstimate = (tier) => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    if (!pCoords || !dCoords) return 0;

    // Street distance (straight-line until the road graph has loaded)
    const dist = routeDistance(pCoords, dCoords);

    const config = VEHICLE_TIERS[tier];
    const weatherFactor = weather === 'rainy' ? 1.3 : 1.0;
    return parseFloat(((config.base + config.perKm * dist) * surgeMultiplier * weatherFactor).toFixed(2));
  };

  // Re-price with street distances once the road graph has loaded
  const [roadsLoaded, setRoadsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    roadsReady().then((r) => { if (r && !cancelled) setRoadsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Recalculate default fare offer when parameters change
  useEffect(() => {
    const recommended = calculateFareEstimate(selectedTier);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- offer is user-editable, reset when inputs change
    setOfferFare(recommended);
  }, [customPickupCoords, customDropoffCoords, selectedTier, weather, surgeMultiplier, roadsLoaded]);

  const isSameLocation = () => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    return pCoords[0] === dCoords[0] && pCoords[1] === dCoords[1];
  };

  // The wallet is charged when the trip completes, so block requests it could not cover
  const shortBy = parseFloat((offerFare - passenger.balance).toFixed(2));
  const insufficient = shortBy > 0;

  const handleBookRide = async () => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    const pName = getSelectedName('pickup');
    const dName = getSelectedName('dropoff');

    if (isSameLocation() || insufficient || requesting) return;
    setRequesting(true);
    setRequestError(null);
    try {
      await requestRide(pCoords, dCoords, pName, dName, selectedTier, offerFare);
    } catch (err) {
      console.error('Failed to request ride:', err);
      setRequestError('We could not send your request. Check your connection and try again.');
    } finally {
      setRequesting(false);
    }
  };

  // ETA in minutes from the street distance still to drive, assuming a 30 km/h city average
  const getETA = () => {
    if (!activeRide) return 0;
    const remaining = activeRide.routePoints.slice(activeRide.currentRouteIndex);
    return Math.max(1, Math.ceil(polylineLength(remaining) / 500));
  };

  const isStandalone = import.meta.env.VITE_APP_ROLE === 'passenger' || window.location.search.includes('role=passenger');

  return (
    <div className={isStandalone ? "flex flex-col h-screen w-screen bg-[#06060c] text-white" : "mobile-frame"}>
      <div className={isStandalone ? "flex-1 flex flex-col h-full w-full" : "mobile-screen"}>
        {!isStandalone && (
          /* Status Bar */
          <div className="status-bar">
            <span>14:35</span>
            <div className="status-icons">
              <CreditCard size={10} />
              <span>5G</span>
              <span>🔋 98%</span>
            </div>
          </div>
        )}

        {/* Dynamic App Body Container */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {/* Header User profile */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <Avatar
                src={passenger.avatar}
                name={passenger.name}
                className="w-8 h-8 rounded-full border border-cyan-500/30"
              />
              <div>
                <p className="text-xs font-bold text-white leading-tight">{passenger.name}</p>
                <div className="flex items-center gap-1">
                  <Star size={8} className="fill-amber-400 text-amber-400" />
                  <span className="text-[9px] text-text-muted">{passenger.rating}</span>
                </div>
              </div>
            </div>
            
            {/* Clickable Balance Card */}
            <button 
              onClick={() => {
                setIsPaymentHubOpen(true);
                setPaymentStep('hub');
              }}
              className="bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-lg text-right hover:bg-cyan-500/20 hover:border-cyan-500/35 transition-all active:scale-95 text-[10px]"
            >
              <span className="text-[8px] text-cyan-400 block uppercase font-bold leading-none">Wallet ↗</span>
              <span className="text-xs font-bold text-white leading-none">N${passenger.balance.toFixed(2)}</span>
            </button>
          </div>

          {/* Booking State Flows */}
          {/* STATE A: Booking Setup Interface */}
          {!activeRide && !reviewRide && (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              {/* Custom Pin drop map view */}
              <div className="relative w-full rounded-2xl overflow-hidden border border-white/5 shrink-0 animate-map-reveal" style={{ height: '132px' }}>
                <MapView
                  height="100%"
                  width="100%"
                  showLocations={true}
                  zoomControl={false}
                  onMapClick={handleMapClick}
                  customPickupCoords={customPickupCoords}
                  customDropoffCoords={customDropoffCoords}
                />
              </div>

              {/* Scrollable booking details; the request button stays pinned below */}
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                {/* Route card: pickup and dropoff joined by a connector */}
                <div className="glass-panel p-3">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center py-[24px] shrink-0" aria-hidden="true">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-cyan-400/20"></span>
                      <span className="flex-1 min-h-[20px] border-l border-dashed border-white/25 my-1.5"></span>
                      <span className="w-2.5 h-2.5 rounded-[3px] bg-pink-500 ring-4 ring-pink-500/20"></span>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {/* Pickup */}
                      <div
                        onClick={() => setActiveSelectionField('pickup')}
                        className={`rounded-xl px-3 py-2 transition-all cursor-pointer border ${
                          activeSelectionField === 'pickup' ? 'bg-cyan-500/10 border-cyan-500/30' : 'border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Pickup</span>
                          {activeSelectionField === 'pickup' && (
                            <span className="text-[10px] text-cyan-400 font-bold animate-pulse">Tap map to set</span>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={pickupSearch}
                            onChange={(e) => setPickupSearch(e.target.value)}
                            onFocus={() => {
                              setIsPickupFocused(true);
                              setActiveSelectionField('pickup');
                            }}
                            onBlur={() => setTimeout(() => setIsPickupFocused(false), 200)}
                            placeholder="Search or type pickup address..."
                            className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0 mt-0.5"
                          />
                          {isPickupFocused && (
                            <div className="glass-panel absolute left-0 right-0 top-full mt-2 max-h-[140px] overflow-y-auto z-[2000] flex flex-col p-1 text-left">
                              {filteredPickupLocations.length > 0 ? (
                                filteredPickupLocations.map(loc => (
                                  <button
                                    key={loc.id}
                                    type="button"
                                    onMouseDown={() => {
                                      setCustomPickupCoords(loc.coords);
                                      setCustomPickupName(loc.name);
                                      setPickupSearch(loc.name);
                                      setIsPickupFocused(false);
                                    }}
                                    className="text-[11px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                  >
                                    {loc.name}
                                  </button>
                                ))
                              ) : (
                                <span className="text-[10px] text-text-muted p-2 text-center">No spots found (custom typed)</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Dropoff */}
                      <div
                        onClick={() => setActiveSelectionField('dropoff')}
                        className={`rounded-xl px-3 py-2 transition-all cursor-pointer border ${
                          activeSelectionField === 'dropoff' ? 'bg-pink-500/10 border-pink-500/30' : 'border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Dropoff</span>
                          {activeSelectionField === 'dropoff' && (
                            <span className="text-[10px] text-pink-400 font-bold animate-pulse">Tap map to set</span>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={dropoffSearch}
                            onChange={(e) => setDropoffSearch(e.target.value)}
                            onFocus={() => {
                              setIsDropoffFocused(true);
                              setActiveSelectionField('dropoff');
                            }}
                            onBlur={() => setTimeout(() => setIsDropoffFocused(false), 200)}
                            placeholder="Where to?"
                            className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0 mt-0.5"
                          />
                          {isDropoffFocused && (
                            <div className="glass-panel absolute left-0 right-0 top-full mt-2 max-h-[140px] overflow-y-auto z-[2000] flex flex-col p-1 text-left">
                              {filteredDropoffLocations.length > 0 ? (
                                filteredDropoffLocations.map(loc => (
                                  <button
                                    key={loc.id}
                                    type="button"
                                    onMouseDown={() => {
                                      setCustomDropoffCoords(loc.coords);
                                      setCustomDropoffName(loc.name);
                                      setDropoffSearch(loc.name);
                                      setIsDropoffFocused(false);
                                    }}
                                    className="text-[11px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                  >
                                    {loc.name}
                                  </button>
                                ))
                              ) : (
                                <span className="text-[10px] text-text-muted p-2 text-center">No destinations found (custom typed)</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Vehicle tiers: three compact cards side by side */}
                <div>
                  <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Choose a ride</span>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    {Object.keys(VEHICLE_TIERS).map(tier => {
                      const info = VEHICLE_TIERS[tier];
                      const fare = calculateFareEstimate(tier);
                      const isSelected = selectedTier === tier;
                      const online = drivers.filter(d => d.status === 'ONLINE_IDLE' && d.tier === tier).length;

                      return (
                        <button
                          key={tier}
                          onClick={() => setSelectedTier(tier)}
                          aria-pressed={isSelected}
                          className={`rounded-xl p-2 flex flex-col items-center gap-0.5 border transition-all active:scale-95 ${
                            isSelected ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5 hover:border-white/10'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-0.5 ${
                            isSelected ? 'bg-cyan-400/20 text-cyan-400' : 'bg-white/5 text-text-muted'
                          }`}>
                            <Navigation2 size={14} />
                          </div>
                          <p className="text-[11px] font-bold text-white leading-tight">{info.name}</p>
                          <p className="text-[10px] text-text-muted leading-tight truncate max-w-full">{info.label}</p>
                          <p className="text-xs font-extrabold text-cyan-300 mt-1">N${fare.toFixed(2)}</p>
                          <span className={`text-[10px] leading-tight ${online > 0 ? 'text-text-muted' : 'text-amber-400'}`}>{online > 0 ? `${online} online` : 'No drivers'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(() => {
                  const onlineTotal = drivers.filter(d => d.status === 'ONLINE_IDLE').length;
                  const selectedOnline = drivers.filter(d => d.status === 'ONLINE_IDLE' && d.tier === selectedTier).length;
                  if (selectedOnline > 0) return null;
                  const alt = Object.keys(VEHICLE_TIERS).find(t => drivers.some(d => d.status === 'ONLINE_IDLE' && d.tier === t));
                  return (
                    <div role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-left flex gap-2.5">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-300 leading-relaxed">
                        {onlineTotal === 0
                          ? 'No drivers are online right now. You can still request a ride and we will keep looking.'
                          : `No ${selectedTier} drivers are online right now. ${alt} has drivers available.`}
                      </p>
                    </div>
                  );
                })()}

                {/* Offer Adjustment: one compact row */}
                <div className="glass-panel p-2.5 flex items-center justify-between gap-2 border border-cyan-400/20 bg-cyan-400/5">
                  <div className="min-w-0">
                    <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider block">Your offer</span>
                    <span className="text-[10px] text-text-muted block truncate">Suggested N${calculateFareEstimate(selectedTier).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setOfferFare(prev => Math.max(1, parseFloat((prev - 1).toFixed(2))))}
                      aria-label="Decrease offer"
                      className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold text-lg hover:bg-white/10 active:scale-95 transition-all"
                    >
                      -
                    </button>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xs font-extrabold text-cyan-400">N$</span>
                      <input
                        type="number"
                        step="0.50"
                        value={offerFare}
                        onChange={(e) => setOfferFare(Math.max(1, parseFloat(parseFloat(e.target.value).toFixed(2)) || 1))}
                        className="bg-transparent border-none text-base font-black text-center text-white focus:outline-none w-16 font-mono"
                      />
                    </div>
                    <button
                      onClick={() => setOfferFare(prev => parseFloat((prev + 1).toFixed(2)))}
                      aria-label="Increase offer"
                      className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold text-lg hover:bg-white/10 active:scale-95 transition-all"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Pinned footer: payment method + request button */}
              <div className="shrink-0 flex flex-col gap-2">
                {insufficient && (
                  <div role="alert" className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-left flex items-center gap-2.5">
                    <AlertTriangle size={14} className="text-danger shrink-0" />
                    <p className="text-[11px] text-white leading-relaxed flex-1">
                      Your wallet is N${shortBy.toFixed(2)} short for this ride.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPaymentHubOpen(true);
                        setPaymentStep('topup');
                      }}
                      className="shrink-0 text-[11px] font-bold text-cyan-400 hover:text-white transition-colors"
                    >
                      Top up
                    </button>
                  </div>
                )}
                {requestError && (
                  <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                    {requestError}
                  </p>
                )}
                <div className="flex justify-between items-center px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    {activePaymentMethod === 'wallet' ? <Wallet size={14} className="text-cyan-400 shrink-0" /> :
                     activePaymentMethod === 'dpo_card' ? <CreditCard size={14} className="text-amber-400 shrink-0" /> :
                     activePaymentMethod === 'dpo_mobile' ? <Phone size={14} className="text-emerald-400 shrink-0" /> :
                     <QrCode size={14} className="text-pink-400 shrink-0" />}
                    <span className="text-[11px] text-white font-semibold truncate">
                      {activePaymentMethod === 'wallet' ? 'Wallet' :
                       activePaymentMethod === 'dpo_card' ? 'DPO Pay' :
                       activePaymentMethod === 'dpo_mobile' ? 'DPO Mobile' : 'PayToday'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPaymentHubOpen(true);
                      setPaymentStep('hub');
                    }}
                    className="text-[10px] text-cyan-400 hover:text-white transition-colors uppercase font-bold"
                  >
                    Change ↗
                  </button>
                </div>

                <button
                  onClick={handleBookRide}
                  disabled={isSameLocation() || insufficient || requesting}
                  className="btn-primary w-full py-3 justify-center text-sm tracking-wide"
                >
                  {requesting ? 'REQUESTING...' : isSameLocation() ? 'PICK A DIFFERENT DROPOFF' : insufficient ? 'TOP UP TO REQUEST' : `REQUEST ${selectedTier.toUpperCase()} · N$${Number(offerFare).toFixed(2)}`}
                </button>
              </div>
            </div>
          )}

          {/* STATE B: DISPATCHING SEARCHING BIDS */}
          {activeRide && activeRide.status === 'REQUESTED' && (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-4 text-center">
                {/* Radar sweep around the search icon */}
                <div className="relative w-28 h-28 my-auto shrink-0 flex items-center justify-center" aria-hidden="true">
                  <span className="absolute inset-0 rounded-full border border-cyan-400/40 animate-ping" style={{ animationDuration: '2.4s' }}></span>
                  <span className="absolute inset-0 rounded-full border border-cyan-400/30 animate-ping" style={{ animationDuration: '2.4s', animationDelay: '0.8s' }}></span>
                  <span className="absolute inset-0 rounded-full border border-cyan-400/20 animate-ping" style={{ animationDuration: '2.4s', animationDelay: '1.6s' }}></span>
                  <span className="absolute inset-4 rounded-full bg-cyan-500/5 border border-cyan-500/20"></span>
                  <div className="relative w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center pulse-glowing-cyan">
                    <Navigation2 size={24} className="text-cyan-400" />
                  </div>
                </div>

                <div role="status" aria-live="polite">
                  <h4 className="text-md font-bold text-white">Finding your driver</h4>
                  <p className="text-xs text-text-muted mt-1 max-w-[220px] mx-auto leading-relaxed">
                    Sending your request to nearby {activeRide.tier} partners.
                  </p>
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono text-cyan-400">
                    Searching <ElapsedTimer since={activeRide.timestamp} />
                  </span>
                </div>

                <SearchingNote since={activeRide.timestamp} tier={activeRide.tier} onlineCount={drivers.filter(d => d.status === 'ONLINE_IDLE' && d.tier === activeRide.tier).length} />

                {/* Request summary */}
                <div className="glass-panel p-3 w-full text-left">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center py-1 shrink-0" aria-hidden="true">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-cyan-400/20"></span>
                      <span className="flex-1 min-h-[20px] border-l border-dashed border-white/25 my-1"></span>
                      <span className="w-2.5 h-2.5 rounded-[3px] bg-pink-500 ring-4 ring-pink-500/20"></span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] text-text-muted uppercase font-bold block">Pickup</span>
                        <span className="text-xs text-white font-semibold block truncate">{activeRide.pickupName}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-text-muted uppercase font-bold block">Dropoff</span>
                        <span className="text-xs text-white font-semibold block truncate">{activeRide.dropoffName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5">
                    <div>
                      <span className="text-[10px] text-text-muted uppercase font-bold block">Ride</span>
                      <span className="text-xs font-bold text-white">{activeRide.tier}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase font-bold block">Distance</span>
                      <span className="text-xs font-bold text-white">{activeRide.distance} km</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase font-bold block">Your offer</span>
                      <span className="text-xs font-bold text-cyan-300">N${Number(activeRide.fare).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => cancelRide(activeRide.id)}
                className="btn-secondary w-full py-3 text-xs text-danger border-danger/25 justify-center shrink-0"
              >
                Cancel request
              </button>
            </div>
          )}

          {/* TRIP SCREENS (ACCEPTED, ARRIVED, IN_PROGRESS): live map above, one adaptive details card below */}
          {activeRide && ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(activeRide.status) && (() => {
            const phases = {
              ACCEPTED: {
                pill: 'Driver on the way',
                title: 'Meet your driver at pickup',
                pillClass: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
                barClass: 'bg-amber-400',
                etaClass: 'text-amber-400',
                dot: 'bg-amber-400',
                target: 'Pickup',
                targetName: activeRide.pickupName,
              },
              ARRIVED: {
                pill: 'Driver arrived',
                title: 'Your driver is waiting',
                pillClass: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
                barClass: 'bg-emerald-400',
                etaClass: 'text-emerald-400',
                dot: 'bg-emerald-400',
                target: 'Pickup',
                targetName: activeRide.pickupName,
              },
              IN_PROGRESS: {
                pill: 'On your way',
                title: 'Heading to your destination',
                pillClass: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400',
                barClass: 'bg-cyan-400',
                etaClass: 'text-cyan-400',
                dot: 'bg-cyan-400',
                target: 'Dropoff',
                targetName: activeRide.dropoffName,
              },
            };
            const ph = phases[activeRide.status];
            const total = Math.max(1, activeRide.routePoints.length);
            const progress = activeRide.status === 'ARRIVED' ? 100 : Math.min(100, Math.round((activeRide.currentRouteIndex / total) * 100));

            return (
              <div className="flex-1 flex flex-col min-h-0 gap-3">
                {/* Live map with a status pill over it */}
                <div className="relative flex-1 min-h-[150px] rounded-2xl overflow-hidden border border-white/5">
                  <MapView height="100%" width="100%" showLocations={false} zoomControl={false} fitRideId={activeRide.id} />
                  <div className={`absolute top-2 left-2 z-[500] flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-md text-[11px] font-bold ${ph.pillClass}`} role="status">
                    <span className={`w-1.5 h-1.5 rounded-full ${ph.dot} animate-pulse`}></span>
                    {ph.pill}
                  </div>
                </div>

                {/* Details card */}
                <div className="shrink-0 max-h-[58%] overflow-y-auto glass-panel p-3 flex flex-col gap-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white leading-tight">{ph.title}</h4>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">{ph.target}: {ph.targetName}</p>
                    </div>
                    {activeRide.status === 'ARRIVED' ? (
                      <Clock size={22} className="text-emerald-400 shrink-0 animate-bounce" />
                    ) : (
                      <div className="text-right shrink-0 leading-none">
                        <span className={`text-2xl font-extrabold ${ph.etaClass}`}>{activeRide.routePoints && activeRide.routePoints.length > 0 ? getETA() : '–'}</span>
                        <span className="text-[11px] text-text-muted ml-0.5">min</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className={`${ph.barClass} h-full rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-text-muted mt-1 font-mono">
                      <span>{activeRide.status === 'IN_PROGRESS' ? 'Trip progress' : activeRide.status === 'ARRIVED' ? 'At pickup' : 'Driver approaching'}</span>
                      <span>{progress}%</span>
                    </div>
                  </div>

                  {/* Driver */}
                  <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                    <Avatar
                      src={activeDriver?.avatar}
                      name={activeDriver?.name || ''}
                      className="w-10 h-10 rounded-full border border-white/10 shrink-0"
                    />
                    <div className="min-w-0 flex-1 text-left">
                      {activeDriver ? (
                        <>
                          <p className="text-xs font-bold text-white leading-tight truncate">{activeDriver.name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star size={10} className="fill-amber-400 text-amber-400" />
                            <span className="text-[11px] text-text-muted">{activeDriver.rating.toFixed(2)}</span>
                            <span className="text-[11px] text-text-muted truncate">· {activeDriver.car}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-bold text-white leading-tight">Your driver</p>
                          <p className="text-[11px] text-text-muted mt-0.5">Loading driver details...</p>
                        </>
                      )}
                    </div>
                    {activeDriver && (
                      <span className="shrink-0 px-2 py-1 rounded-lg bg-black/20 border border-white/10 text-[11px] font-mono font-bold text-white" title="Number plate">
                        SF-{activeDriver.id.toUpperCase().slice(0, 8)}
                      </span>
                    )}
                  </div>

                  {/* Fare + payment */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/5 text-[11px]">
                    <span className="text-text-muted flex items-center gap-1.5">
                      <ShieldCheck size={12} className="text-cyan-400" />
                      Fare locked
                    </span>
                    <span className="font-bold text-cyan-300 text-xs">N${activeRide.fare.toFixed(2)}</span>
                  </div>

                  {activeRide.status === 'ACCEPTED' && (
                    <button
                      onClick={() => cancelRide(activeRide.id)}
                      className="btn-secondary w-full py-2.5 text-xs text-danger border-danger/25 justify-center"
                    >
                      Cancel trip
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* STATE F: RIDE COMPLETED, RECEIPT + DRIVER REVIEW */}
          {!activeRide && reviewRide && (() => {
            const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
            const paymentLabel = activePaymentMethod === 'wallet' ? 'Wallet' :
              activePaymentMethod === 'dpo_card' ? 'DPO Pay (Card)' :
              activePaymentMethod === 'dpo_mobile' ? 'DPO Pay Mobile' : 'PayToday QR';
            // Tolerate incomplete ride data (e.g. a realtime row missing fields) instead of rendering NaN/undefined
            const fare = Number(reviewRide.fare) || 0;
            const distance = Number(reviewRide.distance);

            return (
              <div className="flex-1 flex flex-col min-h-0 gap-3">
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                  {/* Arrival header */}
                  <div className="text-center pt-1">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto mb-2 animate-map-reveal">
                      <CheckCircle2 size={28} className="text-emerald-400" />
                    </div>
                    <h4 className="text-md font-bold text-white">You've arrived</h4>
                    <p className="text-[11px] text-text-muted truncate px-3 mt-0.5">{reviewRide.dropoffName || 'Your destination'}</p>
                  </div>

                  {/* Receipt */}
                  <div className="glass-panel p-3 text-left">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center py-1 shrink-0" aria-hidden="true">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-cyan-400/20"></span>
                        <span className="flex-1 min-h-[18px] border-l border-dashed border-white/25 my-1"></span>
                        <span className="w-2.5 h-2.5 rounded-[3px] bg-pink-500 ring-4 ring-pink-500/20"></span>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                        <span className="text-xs text-white font-semibold block truncate">{reviewRide.pickupName || 'Pickup'}</span>
                        <span className="text-xs text-white font-semibold block truncate">{reviewRide.dropoffName || 'Dropoff'}</span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-1.5 text-[11px]">
                      <div className="flex justify-between text-text-muted">
                        <span>{reviewRide.tier}{distance > 0 ? ` · ${distance} km` : ''}</span>
                        <span className="text-white font-semibold">N${fare.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-text-muted">
                        <span>Paid with</span>
                        <span className="text-white font-semibold">{paymentLabel}</span>
                      </div>
                      <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-white/5">
                        <span className="text-xs font-bold text-white">Total paid</span>
                        <span className="text-base font-extrabold text-emerald-400">N${fare.toFixed(2)}</span>
                      </div>
                      {activePaymentMethod === 'wallet' && (
                        <div className="flex justify-between text-text-muted">
                          <span>Wallet balance</span>
                          <span className="text-white font-semibold">N${passenger.balance.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Driver review */}
                  {!reviewDriver ? (
                    <div className="glass-panel p-3 text-center">
                      <Avatar name="" className="w-11 h-11 rounded-full mx-auto" />
                      <p className="text-xs font-bold text-white mt-2">Driver details unavailable</p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                        We could not load your driver profile, so this trip cannot be rated.
                      </p>
                    </div>
                  ) : (
                  <div className="glass-panel p-3 text-center">
                    <Avatar
                      src={reviewDriver.avatar}
                      name={reviewDriver.name}
                      className="w-11 h-11 rounded-full border border-white/10 mx-auto"
                    />
                    {ratingSubmitted ? (
                      <>
                        <p className="text-xs font-bold text-emerald-400 mt-2">Thanks for the feedback!</p>
                        <p className="text-[11px] text-text-muted mt-0.5">You rated {reviewDriver.name} {givenRating}/5</p>
                      </>
                    ) : (
                      <p className="text-xs font-bold text-white mt-2">How was your ride with {reviewDriver.name}?</p>
                    )}

                    <div className="flex justify-center gap-1.5 mt-2" role="radiogroup" aria-label="Rate your driver">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button
                          key={star}
                          type="button"
                          role="radio"
                          aria-checked={star === givenRating}
                          aria-label={`${star} star${star > 1 ? 's' : ''}`}
                          disabled={ratingSubmitted}
                          onClick={() => setGivenRating(star)}
                          className="p-0.5 transition-all hover:scale-110 active:scale-90 disabled:hover:scale-100 disabled:cursor-default"
                        >
                          <Star
                            size={28}
                            className={star <= givenRating ? 'fill-amber-400 text-amber-400' : 'text-text-muted'}
                          />
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] font-bold text-amber-400 mt-1 h-4">{labels[givenRating]}</p>
                  </div>
                  )}
                </div>

                {/* Pinned actions */}
                <div className="shrink-0 flex flex-col gap-1.5">
                  {ratingSubmitted || !reviewDriver ? (
                    <button onClick={dismissReview} className="btn-primary w-full py-3 text-sm justify-center">
                      Book another ride
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          submitRating(reviewRide.id, givenRating);
                          setRatingSubmitted(true);
                        }}
                        className="btn-primary w-full py-3 text-sm justify-center"
                      >
                        Submit rating
                      </button>
                      <button onClick={dismissReview} className="text-[11px] text-text-muted hover:text-white py-1 transition-colors">
                        Skip for now
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Wallet & Payments Hub Overlay Modal */}
          {isPaymentHubOpen && (
            <div className="absolute inset-0 bg-[#06060c]/98 z-[3000] flex flex-col p-4 animate-fade-in text-left">
              {/* Header */}
              <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-4">
                <div className="flex items-center gap-1.5">
                  <Wallet size={16} className="text-cyan-400 animate-pulse" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Payments & Wallet Hub</h3>
                </div>
                <button 
                  onClick={() => setIsPaymentHubOpen(false)}
                  className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-muted hover:text-white transition-all active:scale-90"
                >
                  <X size={12} />
                </button>
              </div>

              {/* Main steps */}
              {paymentStep === 'hub' && (
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    {/* Balance Display Card */}
                    <div className="glass-panel p-4 bg-gradient-to-br from-cyan-950/20 to-indigo-950/20 border border-cyan-400/20 text-center mb-4">
                      <span className="text-[9px] uppercase tracking-widest text-cyan-400 font-bold block mb-1">Total Available Balance</span>
                      <h2 className="text-3xl font-black text-white">N${passenger.balance.toFixed(2)}</h2>
                      <p className="text-[8px] text-text-muted mt-1">Windhoek Dispatch Credits</p>
                    </div>

                    {/* Default Booking payment method */}
                    <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block mb-2">Default Billing Source</span>
                    <div className="flex flex-col gap-2 mb-4">
                      {[
                        { id: 'wallet', name: 'Simulated Wallet', desc: 'Deduct from credits', icon: Wallet, color: 'text-cyan-400' },
                        { id: 'dpo_card', name: 'DPO Pay (Card)', desc: 'Direct Credit/Debit Card', icon: CreditCard, color: 'text-amber-400' },
                        { id: 'dpo_mobile', name: 'DPO Pay Mobile', desc: 'Mobile Money (M-Pesa, etc.)', icon: Phone, color: 'text-emerald-400' },
                        { id: 'paytoday', name: 'PayToday Merchant', desc: 'Direct PayToday Namibia App', icon: QrCode, color: 'text-pink-400' }
                      ].map(method => {
                        const isSelected = activePaymentMethod === method.id;
                        const Icon = method.icon;
                        return (
                          <button
                            key={method.id}
                            onClick={() => setActivePaymentMethod(method.id)}
                            className={`p-2.5 rounded-xl border flex justify-between items-center text-left transition-all ${
                              isSelected ? 'border-cyan-500 bg-cyan-500/5' : 'border-white/5 bg-black/20 hover:border-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={14} className={method.color} />
                              <div>
                                <p className="text-xs font-bold text-white leading-tight">{method.name}</p>
                                <p className="text-[9px] text-text-muted leading-tight">{method.desc}</p>
                              </div>
                            </div>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center text-black">
                                <Check size={10} strokeWidth={3} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Top up action */}
                  <button
                    onClick={() => {
                      setPaymentStep('topup');
                      setTopUpAmount(100);
                    }}
                    className="btn-primary w-full py-2.5 justify-center bg-cyan-400 text-black font-bold uppercase tracking-wider text-xs"
                  >
                    Top Up Balance
                  </button>
                </div>
              )}

              {paymentStep === 'topup' && (
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    {/* Back button */}
                    <button 
                      onClick={() => setPaymentStep('hub')}
                      className="text-[10px] text-cyan-400 underline mb-4 block"
                    >
                      ← Back to Wallet Hub
                    </button>

                    {/* Amount selector */}
                    <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block mb-2">1. Enter Top Up Amount</span>
                    <div className="flex items-center justify-between gap-4 bg-black/20 p-2 rounded-xl border border-white/5 mb-4">
                      <button 
                        onClick={() => setTopUpAmount(prev => Math.max(10, prev - 50))}
                        className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold hover:bg-white/10 transition-all"
                      >
                        -
                      </button>
                      <div className="flex items-baseline justify-center gap-1 flex-1">
                        <span className="text-xl font-extrabold text-cyan-400">N$</span>
                        <input 
                          type="number"
                          step="50"
                          value={topUpAmount}
                          onChange={(e) => setTopUpAmount(Math.max(10, parseInt(e.target.value) || 10))}
                          className="bg-transparent border-none text-2xl font-black text-center text-white focus:outline-none w-24 font-mono"
                        />
                      </div>
                      <button 
                        onClick={() => setTopUpAmount(prev => prev + 50)}
                        className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold hover:bg-white/10 transition-all"
                      >
                        +
                      </button>
                    </div>

                    {/* Gateway Selectors */}
                    <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block mb-2">2. Choose Payment Gateway</span>
                    <div className="flex flex-col gap-2">
                      {[
                        { id: 'dpo_card', name: 'DPO Pay Gateway', desc: 'Secure card checkout simulation', label: 'Card Payment', icon: CreditCard, color: 'text-amber-400' },
                        { id: 'dpo_mobile', name: 'DPO Pay MobileMoney', desc: 'M-Pesa, Airtel Pay mobile gateway', label: 'Mobile Money', icon: Phone, color: 'text-emerald-400' },
                        { id: 'paytoday', name: 'PayToday Merchant App', desc: 'Simulated QR app push confirmation', label: 'Instant PayToday QR', icon: QrCode, color: 'text-pink-400' }
                      ].map(gt => {
                        const isSelected = selectedGateway === gt.id;
                        const Icon = gt.icon;
                        return (
                          <button
                            key={gt.id}
                            onClick={() => setSelectedGateway(gt.id)}
                            className={`p-3 rounded-xl border flex justify-between items-center text-left transition-all ${
                              isSelected ? 'border-cyan-500 bg-cyan-500/5' : 'border-white/5 bg-black/20 hover:border-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <Icon size={16} className={gt.color} />
                              <div>
                                <p className="text-xs font-bold text-white leading-tight">{gt.name}</p>
                                <span className="text-[8px] bg-white/5 border border-white/10 text-text-muted px-1.5 py-0.5 rounded uppercase font-semibold block mt-1 w-max">{gt.label}</span>
                              </div>
                            </div>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center text-black">
                                <Check size={10} strokeWidth={3} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Proceed to checkout */}
                  <button
                    onClick={() => {
                      setPaymentStep('gateway_input');
                      setCardNo('4111 2222 3333 4444');
                      setCardExpiry('12/28');
                      setCardCVV('123');
                      setMobileNo('+264 81 234 5678');
                      setMobileProvider('M-Pesa');
                    }}
                    className="btn-primary w-full py-2.5 justify-center bg-cyan-400 text-black font-bold uppercase tracking-wider text-xs"
                  >
                    Proceed to Checkout (N${topUpAmount})
                  </button>
                </div>
              )}

              {paymentStep === 'gateway_input' && (
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <button 
                      onClick={() => setPaymentStep('topup')}
                      className="text-[10px] text-cyan-400 underline mb-4 block"
                    >
                      ← Back to Selection
                    </button>

                    {selectedGateway === 'dpo_card' && (
                      /* DPO Card payment checkout screen */
                      <div className="glass-panel p-4 border border-amber-500/20 bg-amber-500/5 flex flex-col gap-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                          <span className="text-[9px] uppercase tracking-wider font-extrabold text-amber-400">DPO Pay Card Checkout</span>
                          <CreditCard size={14} className="text-amber-400" />
                        </div>

                        <div>
                          <label className="text-[8px] uppercase font-bold text-text-muted block mb-1">Card Number</label>
                          <input 
                            type="text" 
                            value={cardNo}
                            onChange={(e) => setCardNo(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50 font-mono"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[8px] uppercase font-bold text-text-muted block mb-1">Expiry Date</label>
                            <input 
                              type="text" 
                              value={cardExpiry}
                              onChange={(e) => setCardExpiry(e.target.value)}
                              placeholder="MM/YY"
                              className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50 font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[8px] uppercase font-bold text-text-muted block mb-1">CVV</label>
                            <input 
                              type="password" 
                              value={cardCVV}
                              onChange={(e) => setCardCVV(e.target.value)}
                              maxLength={3}
                              className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50 font-mono"
                            />
                          </div>
                        </div>

                        <p className="text-[8px] text-text-muted leading-tight mt-1 text-center font-medium">Protected by DPO Secure 3D-Secure Protocol.</p>
                      </div>
                    )}

                    {selectedGateway === 'dpo_mobile' && (
                      /* DPO Mobile Money checkout screen */
                      <div className="glass-panel p-4 border border-emerald-500/20 bg-emerald-500/5 flex flex-col gap-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                          <span className="text-[9px] uppercase tracking-wider font-extrabold text-emerald-400">DPO Pay Mobile Money</span>
                          <Phone size={14} className="text-emerald-400" />
                        </div>

                        <div>
                          <label className="text-[8px] uppercase font-bold text-text-muted block mb-1">Mobile Provider</label>
                          <select 
                            value={mobileProvider} 
                            onChange={(e) => setMobileProvider(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 cursor-pointer"
                          >
                            <option value="M-Pesa">M-Pesa (Namibia / regional)</option>
                            <option value="Airtel Money">Airtel Money</option>
                            <option value="Orange Money">Orange Money</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[8px] uppercase font-bold text-text-muted block mb-1">Mobile Number</label>
                          <input 
                            type="text" 
                            value={mobileNo}
                            onChange={(e) => setMobileNo(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 font-mono"
                          />
                        </div>

                        <p className="text-[8px] text-text-muted leading-tight mt-1 text-center font-medium">A prompt will be pushed to your mobile device.</p>
                      </div>
                    )}

                    {selectedGateway === 'paytoday' && (
                      /* PayToday merchant code checkout screen */
                      <div className="glass-panel p-4 border border-pink-500/20 bg-pink-500/5 flex flex-col items-center gap-3">
                        <div className="w-full flex justify-between items-center border-b border-white/5 pb-2 text-left">
                          <span className="text-[9px] uppercase tracking-wider font-extrabold text-pink-400">PayToday Merchant QR</span>
                          <QrCode size={14} className="text-pink-400" />
                        </div>

                        <div className="w-24 h-24 bg-white p-1 rounded-lg flex items-center justify-center my-1">
                          <div className="w-full h-full border-4 border-black border-dashed flex items-center justify-center text-[10px] text-black font-extrabold text-center">
                            PayToday<br/>QR-CODE
                          </div>
                        </div>

                        <p className="text-[9px] text-white font-bold leading-tight text-center">Merchant ID: <span className="font-mono text-pink-400">ORBITRIDE-WDH</span></p>
                        <p className="text-[8px] text-text-muted leading-tight text-center max-w-[180px] font-medium">Scan this QR Code via the PayToday App on your mobile device, or click below to mock app-push approval.</p>
                      </div>
                    )}
                  </div>

                {/* Action Payment Confirmation */}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedGateway === 'dpo_card') {
                      setPaymentStep('3ds');
                      setCardOTP('123456');
                    } else {
                      setPaymentStep('processing');
                      setTimeout(() => {
                        topUpPassengerBalance(topUpAmount);
                        setPaymentStep('success');
                      }, 2500);
                    }
                  }}
                  className={`w-full py-2.5 justify-center font-bold uppercase tracking-wider text-xs rounded-xl flex items-center gap-1.5 ${
                    selectedGateway === 'dpo_card' ? 'bg-amber-400 text-black hover:bg-amber-500' :
                    selectedGateway === 'dpo_mobile' ? 'bg-emerald-500 text-black hover:bg-emerald-600' :
                    'bg-pink-500 text-white hover:bg-pink-600'
                  }`}
                >
                  {selectedGateway === 'paytoday' ? 'Simulate QR Scan Confirmation' : `Authorize Payment N$${topUpAmount}`}
                </button>
              </div>
            )}

            {paymentStep === '3ds' && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-400 block mb-1">DPO Secure Card Authentication</span>
                  <p className="text-[9px] text-text-muted mb-4">We sent a mock one-time password (OTP) verification request to your registered phone number.</p>

                  <div className="glass-panel p-4 flex flex-col gap-3">
                    <div>
                      <label className="text-[8px] uppercase font-bold block mb-1">Enter OTP (6-digits)</label>
                      <input 
                        type="text" 
                        maxLength={6}
                        value={cardOTP}
                        onChange={(e) => setCardOTP(e.target.value)}
                        placeholder="e.g. 123456"
                        className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white text-center focus:outline-none focus:border-amber-500/50 font-mono tracking-widest"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPaymentStep('processing');
                    setTimeout(() => {
                      topUpPassengerBalance(topUpAmount);
                      setPaymentStep('success');
                    }, 2000);
                  }}
                  disabled={cardOTP.length < 4}
                  className="btn-primary w-full py-2.5 justify-center bg-amber-400 text-black font-bold uppercase tracking-wider text-xs disabled:opacity-50"
                >
                  Submit OTP Verification
                </button>
              </div>
            )}

            {paymentStep === 'processing' && (
              <div className="flex-1 flex flex-col justify-center items-center text-center gap-3">
                <Loader2 size={36} className="text-cyan-400 animate-spin" />
                <h4 className="text-sm font-bold text-white">Contacting Gateway...</h4>
                <p className="text-[10px] text-text-muted max-w-[180px] font-medium">
                  {selectedGateway === 'dpo_card' ? 'Authenticating card credentials with DPO Merchant Service...' :
                   selectedGateway === 'dpo_mobile' ? 'Awaiting response from network mobile money push...' :
                   'Confirming payment authorization code from PayToday App...'}
                </p>
              </div>
            )}

            {paymentStep === 'success' && (
              <div className="flex-grow flex flex-col justify-between py-2 text-center">
                <div className="my-auto flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
                    <Check size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-white">Payment Authorized</h4>
                  <p className="text-xs text-emerald-400 font-bold mt-1">N$ {topUpAmount.toFixed(2)} Added</p>
                  <p className="text-[9px] text-text-muted max-w-[180px] mt-2 leading-relaxed font-medium">
                    Your simulated wallet balance has been credited via {
                      selectedGateway === 'dpo_card' ? 'DPO Pay Secure Card checkout.' :
                      selectedGateway === 'dpo_mobile' ? 'DPO Pay Mobile Money verification.' :
                      'PayToday instant merchant transfer.'
                    }
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsPaymentHubOpen(false);
                  }}
                  className="btn-primary w-full py-2.5 justify-center bg-cyan-400 text-black font-bold uppercase tracking-wider text-xs"
                >
                  Return to Simulation
                </button>
              </div>
            )}
          </div>
          )}

        </div>
      </div>
    </div>
  );
}
