import React, { useState, useEffect } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS, VEHICLE_TIERS } from '../context/SimulationContext';
import { 
  MapPin, Navigation2, Star, CreditCard, ChevronRight, 
  Search, ShieldCheck, Clock, User, Compass, CheckCircle2,
  Wallet, QrCode, Phone, X, Check, Loader2
} from 'lucide-react';
import MapView from './MapView';

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
      setCustomPickupCoords(coords);
      setCustomPickupName(pickupSearch);
    }
  }, [pickupSearch, isPickupFocused]);

  // Geocode dropoff when text changes
  useEffect(() => {
    if (isDropoffFocused && dropoffSearch.trim()) {
      const coords = resolveCoordinatesForAddress(dropoffSearch);
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

  // Recalculate default fare offer when parameters change
  useEffect(() => {
    const recommended = calculateFareEstimate(selectedTier);
    setOfferFare(recommended);
  }, [customPickupCoords, customDropoffCoords, selectedTier, weather, surgeMultiplier]);

  // Find active ride associated with passenger
  const activeRide = rides.find(r => r.id === passenger.activeRideId);
  const activeDriver = activeRide ? drivers.find(d => d.id === activeRide.driverId) : null;
  
  const calculateFareEstimate = (tier) => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    if (!pCoords || !dCoords) return 0;

    const lat1 = pCoords[0];
    const lon1 = pCoords[1];
    const lat2 = dCoords[0];
    const lon2 = dCoords[1];
    
    // Haversine formula
    const R = 6371.0; // kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const dist = R * c;

    const config = VEHICLE_TIERS[tier];
    const weatherFactor = weather === 'rainy' ? 1.3 : 1.0;
    return parseFloat(((config.base + config.perKm * dist) * surgeMultiplier * weatherFactor).toFixed(2));
  };

  const isSameLocation = () => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    return pCoords[0] === dCoords[0] && pCoords[1] === dCoords[1];
  };

  const handleBookRide = () => {
    const pCoords = getSelectedCoords('pickup');
    const dCoords = getSelectedCoords('dropoff');
    const pName = getSelectedName('pickup');
    const dName = getSelectedName('dropoff');

    if (isSameLocation()) return;
    requestRide(pCoords, dCoords, pName, dName, selectedTier, offerFare);
  };

  // Get dynamic ETA
  const getETA = () => {
    if (!activeRide) return 0;
    const totalPoints = activeRide.routePoints.length;
    const pointsLeft = totalPoints - activeRide.currentRouteIndex;
    // 1 tick = 1 point. 1 point is 1 sec.
    return Math.max(1, Math.ceil(pointsLeft / 5)); // simulated dynamic min countdown
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
              <img 
                src={passenger.avatar} 
                alt={passenger.name} 
                className="w-8 h-8 rounded-full border border-cyan-500/30 object-cover"
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
          {!activeRide && (
            <div className="flex-1 flex flex-col justify-between">
              {/* Custom Pin drop map view */}
              <div className="w-full h-[140px] rounded-xl overflow-hidden mb-3 border border-white/5 shrink-0 animate-map-reveal" style={{ position: 'relative', height: '140px' }}>
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

              {/* Location Selectors */}
              <div className="flex flex-col gap-3">
                <div className="glass-panel p-3 flex flex-col gap-3">
                  {/* Pickup Selection Block */}
                  <div className="flex flex-col gap-1.5 border-b border-white/5 pb-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Pickup Location</span>
                      {activeSelectionField === 'pickup' && (
                        <span className="text-[7px] text-cyan-400 font-bold animate-pulse">● Active Map Pin Selection</span>
                      )}
                    </div>

                    <div 
                      onClick={() => setActiveSelectionField('pickup')}
                      className={`flex items-center gap-2 p-1.5 rounded-lg transition-all cursor-pointer ${
                        activeSelectionField === 'pickup' ? 'bg-cyan-500/10 border border-cyan-500/30' : 'border border-white/5 hover:border-white/10'
                      }`}
                    >
                      <MapPin size={14} className="text-cyan-400 shrink-0" />
                      <div className="flex-1 min-w-0 relative">
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
                          className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0"
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
                                  className="text-[10px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                >
                                  {loc.name}
                                </button>
                              ))
                            ) : (
                              <span className="text-[9px] text-text-muted p-2 text-center">No spots found (custom typed)</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Dropoff Selection Block */}
                  <div className="flex flex-col gap-1.5 pt-0.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Dropoff Destination</span>
                      {activeSelectionField === 'dropoff' && (
                        <span className="text-[7px] text-pink-400 font-bold animate-pulse">● Active Map Pin Selection</span>
                      )}
                    </div>

                    <div 
                      onClick={() => setActiveSelectionField('dropoff')}
                      className={`flex items-center gap-2 p-1.5 rounded-lg transition-all cursor-pointer ${
                        activeSelectionField === 'dropoff' ? 'bg-cyan-500/10 border border-cyan-500/30' : 'border border-white/5 hover:border-white/10'
                      }`}
                    >
                      <Compass size={14} className="text-pink-500 shrink-0" />
                      <div className="flex-1 min-w-0 relative">
                        <input
                          type="text"
                          value={dropoffSearch}
                          onChange={(e) => setDropoffSearch(e.target.value)}
                          onFocus={() => {
                            setIsDropoffFocused(true);
                            setActiveSelectionField('dropoff');
                          }}
                          onBlur={() => setTimeout(() => setIsDropoffFocused(false), 200)}
                          placeholder="Search or type destination..."
                          className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0"
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
                                  className="text-[10px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                >
                                  {loc.name}
                                </button>
                              ))
                            ) : (
                              <span className="text-[9px] text-text-muted p-2 text-center">No destinations found (custom typed)</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ride Option selector tiles */}
                <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Select Vehicle Tier</span>
                <div className="flex flex-col gap-2">
                  {Object.keys(VEHICLE_TIERS).map(tier => {
                    const info = VEHICLE_TIERS[tier];
                    const fare = calculateFareEstimate(tier);
                    const isSelected = selectedTier === tier;
                    
                    return (
                      <button 
                        key={tier}
                        onClick={() => setSelectedTier(tier)}
                        className={`glass-panel p-2.5 flex justify-between items-center border transition-all ${
                          isSelected ? 'border-cyan-400 bg-cyan-400/5' : 'border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isSelected ? 'bg-cyan-400/20 text-cyan-400' : 'bg-white/5 text-text-muted'
                          }`}>
                            <Navigation2 size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">{info.name}</p>
                            <p className="text-[9px] text-text-muted">{info.label}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-cyan-300">N${fare.toFixed(2)}</p>
                          <span className="text-[8px] text-text-muted">Est. 4 min</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Offer Adjustment Panel */}
              <div className="glass-panel p-3 flex flex-col gap-2 border border-cyan-400/20 bg-cyan-400/5 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">Offer Your Fare</span>
                  <span className="text-[9px] text-text-muted">Recommended: N${calculateFareEstimate(selectedTier).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 mt-1 bg-black/20 p-1.5 rounded-lg border border-white/5">
                  <button 
                    onClick={() => setOfferFare(prev => Math.max(1, parseFloat((prev - 1).toFixed(2))))}
                    className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold text-lg hover:bg-white/10 active:scale-95 transition-all"
                  >
                    -
                  </button>
                  <div className="flex items-baseline justify-center gap-0.5 flex-1">
                    <span className="text-xl font-extrabold text-cyan-400">N$</span>
                    <input 
                      type="number"
                      step="0.50"
                      value={offerFare}
                      onChange={(e) => setOfferFare(Math.max(1, parseFloat(parseFloat(e.target.value).toFixed(2)) || 1))}
                      className="bg-transparent border-none text-2xl font-black text-center text-white focus:outline-none w-24 font-mono"
                    />
                  </div>
                  <button 
                    onClick={() => setOfferFare(prev => parseFloat((prev + 1).toFixed(2)))}
                    className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white font-bold text-lg hover:bg-white/10 active:scale-95 transition-all"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Booking Payment Selector */}
              <div className="flex justify-between items-center p-2 rounded-lg bg-white/5 border border-white/10 mt-3 text-left">
                <div className="flex items-center gap-1.5">
                  {activePaymentMethod === 'wallet' ? <Wallet size={12} className="text-cyan-400" /> :
                   activePaymentMethod === 'dpo_card' ? <CreditCard size={12} className="text-amber-400" /> :
                   activePaymentMethod === 'dpo_mobile' ? <Phone size={12} className="text-emerald-400" /> :
                   <QrCode size={12} className="text-pink-400" />}
                  <span className="text-[10px] text-white font-semibold">
                    Payment Method: <span className="text-cyan-400">
                      {activePaymentMethod === 'wallet' ? 'Wallet' :
                       activePaymentMethod === 'dpo_card' ? 'DPO Pay' :
                       activePaymentMethod === 'dpo_mobile' ? 'DPO Mobile' : 'PayToday'}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPaymentHubOpen(true);
                    setPaymentStep('hub');
                  }}
                  className="text-[9px] text-cyan-400 hover:text-white transition-colors uppercase font-bold"
                >
                  Change ↗
                </button>
              </div>

              {/* Action Booking Button */}
              <button 
                onClick={handleBookRide}
                disabled={isSameLocation()}
                className="btn-primary w-full py-3 justify-center text-sm tracking-wide mt-4"
              >
                REQUEST {selectedTier.toUpperCase()}
              </button>
            </div>
          )}

          {/* STATE B: DISPATCHING SEARCHING BIDS */}
          {activeRide && activeRide.status === 'REQUESTED' && (
            <div className="flex-1 flex flex-col justify-between items-center py-6 text-center">
              <div className="my-auto flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center pulse-glowing-cyan mb-4">
                  <Navigation2 size={28} className="text-cyan-400 animate-pulse" />
                </div>
                <h4 className="text-sm font-bold text-white">Finding Your Driver</h4>
                <p className="text-xs text-text-muted max-w-[200px] mt-1">
                  Connecting with premium Orbit partners in your area...
                </p>
              </div>

              <button 
                onClick={() => cancelRide(activeRide.id)}
                className="btn-secondary w-full py-2.5 text-xs text-danger border-danger/25 justify-center"
              >
                Cancel Request
              </button>
            </div>
          )}

          {/* MAP-ENABLED TRIP CHANNELS (ACCEPTED, ARRIVED, IN_PROGRESS) */}
          {activeRide && ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(activeRide.status) && activeDriver && (
            <div className="flex-1 flex flex-col justify-between h-full">
              {/* Live Mini Map inside Client viewport */}
              <div className="w-full h-[180px] rounded-xl overflow-hidden mb-3 border border-white/5 shrink-0" style={{ position: 'relative', height: '180px' }}>
                <MapView height="100%" width="100%" showLocations={false} zoomControl={false} fitRideId={activeRide.id} />
              </div>

              {/* Status Specific details panel */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0">
                {activeRide.status === 'ACCEPTED' && (
                  <>
                    <div className="glass-panel p-2.5 text-center border-l-4 border-l-amber-400">
                      <span className="text-[8px] uppercase tracking-wide text-text-muted font-bold block">Driver is arriving in</span>
                      <p className="text-2xl font-extrabold text-white mt-0.5">{getETA()} min</p>
                      <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
                        <div 
                          className="bg-amber-400 h-full transition-all duration-300"
                          style={{ width: `${(activeRide.currentRouteIndex / activeRide.routePoints.length) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="glass-panel p-2.5 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <img 
                            src={activeDriver.avatar} 
                            alt={activeDriver.name} 
                            className="w-8 h-8 rounded-full object-cover border border-amber-400/20"
                          />
                          <div>
                            <p className="text-xs font-bold text-white leading-none">{activeDriver.name}</p>
                            <p className="text-[8px] text-text-muted mt-0.5">⭐ {activeDriver.rating.toFixed(2)} Rating</p>
                          </div>
                        </div>
                        <span className="badge badge-amber text-[8px]">En Route</span>
                      </div>

                      <div className="bg-black/20 p-1.5 rounded-lg border border-white/5 text-[9px] text-left">
                        <p className="text-white font-semibold leading-none">{activeDriver.car}</p>
                        <p className="text-text-muted mt-0.5">Plate: <span className="text-amber-400 font-mono">SF-{activeDriver.id.toUpperCase()}</span></p>
                      </div>
                    </div>

                    <button 
                      onClick={() => cancelRide(activeRide.id)}
                      className="btn-secondary w-full py-2 text-xs text-danger border-danger/25 justify-center mt-auto"
                    >
                      Cancel Trip
                    </button>
                  </>
                )}

                {activeRide.status === 'ARRIVED' && (
                  <>
                    <div className="glass-panel p-3 text-center pulse-glowing-emerald">
                      <Clock size={16} className="text-emerald-400 mx-auto animate-bounce mb-1" />
                      <h4 className="text-[10px] font-bold text-white uppercase tracking-wider">Driver Waiting</h4>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {activeDriver.name} is waiting at your designated pickup spot!
                      </p>
                    </div>

                    <div className="glass-panel p-2.5 flex items-center gap-2">
                      <img 
                        src={activeDriver.avatar} 
                        alt={activeDriver.name} 
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div className="text-left flex-1">
                        <p className="text-xs font-bold text-white leading-none">{activeDriver.name}</p>
                        <p className="text-[8px] text-text-muted mt-0.5">{activeDriver.car}</p>
                      </div>
                      <span className="badge badge-emerald text-[8px] animate-pulse">Arrived</span>
                    </div>

                    <div className="bg-black/30 p-2 rounded-xl border border-white/5 text-center text-[10px] text-text-muted">
                      ⏱️ Please proceed to the vehicle.
                    </div>
                  </>
                )}

                {activeRide.status === 'IN_PROGRESS' && (
                  <>
                    <div className="glass-panel p-2.5 text-center border-l-4 border-l-cyan-400">
                      <span className="text-[8px] uppercase tracking-wide text-text-muted font-bold block">Heading to dropoff</span>
                      <p className="text-xs font-bold text-white mt-0.5 truncate">{activeRide.dropoffName}</p>
                      
                      <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
                        <div 
                          className="bg-cyan-400 h-full transition-all duration-300"
                          style={{ width: `${(activeRide.currentRouteIndex / activeRide.routePoints.length) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[7px] text-text-muted mt-1 font-mono">
                        <span>Progress</span>
                        <span>{Math.round((activeRide.currentRouteIndex / activeRide.routePoints.length) * 100)}%</span>
                      </div>
                    </div>

                    <div className="glass-panel p-2.5 flex items-center gap-2">
                      <ShieldCheck size={16} className="text-cyan-400" />
                      <div className="text-left">
                        <p className="text-xs font-bold text-white leading-none">Ride Secured</p>
                        <p className="text-[8px] text-text-muted mt-0.5">GPS tracking & Speed compliance active</p>
                      </div>
                    </div>

                    <div className="text-[9px] text-text-muted bg-black/20 p-2 rounded-lg text-center mt-auto border border-white/5">
                      Fare locked at booking: <b className="text-cyan-400">N${activeRide.fare.toFixed(2)}</b>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* STATE F: RIDE COMPLETED & REVIEW PANEL */}
          {activeRide && activeRide.status === 'COMPLETED' && activeDriver && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="text-center">
                <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-white">Thanks for choosing Orbit!</h4>
                <p className="text-[10px] text-text-muted">Trip details logged & paid</p>
              </div>

              {/* Invoice Breakdown */}
              <div className="glass-panel p-3 mt-4 text-left">
                <span className="text-[9px] uppercase tracking-wide text-text-muted font-bold">Trip Invoice</span>
                <div className="flex justify-between text-xs text-white font-semibold mt-2 pb-1.5 border-b border-muted">
                  <span>Fare Charge ({activeRide.tier})</span>
                  <span>N${activeRide.fare.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-text-muted mt-2">
                  <span>Payment Type</span>
                  <span>
                    {activePaymentMethod === 'wallet' ? 'Wallet Debit' :
                     activePaymentMethod === 'dpo_card' ? 'DPO Pay (Card)' :
                     activePaymentMethod === 'dpo_mobile' ? 'DPO Pay Mobile' : 'PayToday QR'}
                  </span>
                </div>
              </div>

              {/* Interactive review stars feedback */}
              <div className="glass-panel p-3 text-center mt-4">
                <p className="text-xs font-bold text-white mb-2">Rate Driver {activeDriver.name}</p>
                
                {ratingSubmitted ? (
                  <p className="text-xs text-emerald-400 font-semibold py-1">Review feedback logged!</p>
                ) : (
                  <div className="flex justify-center gap-2 py-1">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button 
                        key={star}
                        onClick={() => setGivenRating(star)}
                        className="transition-all hover:scale-110"
                      >
                        <Star 
                          size={18} 
                          className={star <= givenRating ? 'fill-amber-400 text-amber-400' : 'text-text-muted'} 
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button 
                onClick={() => {
                  setRatingSubmitted(false);
                  // Quick state hack to clear completed state
                  window.location.reload();
                }}
                className="btn-primary w-full py-2.5 text-xs justify-center mt-auto"
              >
                Book Another Ride
              </button>
            </div>
          )}

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
