import React, { useState, useEffect } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS, VEHICLE_TIERS } from '../context/SimulationContext';
import { 
  MapPin, Navigation2, Star, CreditCard, ChevronRight, 
  Search, ShieldCheck, Clock, User, Compass, CheckCircle2 
} from 'lucide-react';
import MapView from './MapView';

export default function ClientApp() {
  const {
    passenger,
    rides,
    requestRide,
    cancelRide,
    drivers,
    weather,
    surgeMultiplier
  } = useSimulation();

  // Screen states
  const [pickupId, setPickupId] = useState('loc-cbd');
  const [dropoffId, setDropoffId] = useState('loc-airport');
  const [selectedTier, setSelectedTier] = useState('OrbitX');
  
  // Custom Selection States
  const [pickupMode, setPickupMode] = useState('preset'); // preset | custom
  const [dropoffMode, setDropoffMode] = useState('preset'); // preset | custom
  const [customPickupCoords, setCustomPickupCoords] = useState([-22.5615, 17.0835]);
  const [customDropoffCoords, setCustomDropoffCoords] = useState([-22.6120, 17.0795]);
  const [customPickupName, setCustomPickupName] = useState('Custom Pickup Location');
  const [customDropoffName, setCustomDropoffName] = useState('Custom Dropoff Location');
  const [activeSelectionField, setActiveSelectionField] = useState('pickup'); // pickup | dropoff

  // Rating states upon completion
  const [givenRating, setGivenRating] = useState(5);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const [offerFare, setOfferFare] = useState(0);

  // Map Click Handler for Dropping Custom Pins and Selecting Locations
  const handleMapClick = (coords, name = null) => {
    const defaultPickupName = name || `Custom Pickup Spot (${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})`;
    const defaultDropoffName = name || `Custom Destination (${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})`;
    if (activeSelectionField === 'pickup') {
      setCustomPickupCoords(coords);
      setCustomPickupName(defaultPickupName);
      setPickupMode('custom');
    } else {
      setCustomDropoffCoords(coords);
      setCustomDropoffName(defaultDropoffName);
      setDropoffMode('custom');
    }
  };

  // Helper to retrieve active coordinates
  const getSelectedCoords = (type) => {
    if (type === 'pickup') {
      if (pickupMode === 'preset') {
        const loc = WINDHOEK_LOCATIONS.find(l => l.id === pickupId);
        return loc ? loc.coords : [-22.5615, 17.0835];
      }
      return customPickupCoords;
    } else {
      if (dropoffMode === 'preset') {
        const loc = WINDHOEK_LOCATIONS.find(l => l.id === dropoffId);
        return loc ? loc.coords : [-22.6120, 17.0795];
      }
      return customDropoffCoords;
    }
  };

  // Helper to retrieve active names
  const getSelectedName = (type) => {
    if (type === 'pickup') {
      if (pickupMode === 'preset') {
        const loc = WINDHOEK_LOCATIONS.find(l => l.id === pickupId);
        return loc ? loc.name : 'Windhoek CBD';
      }
      return customPickupName || `Custom Coordinates (${customPickupCoords[0].toFixed(4)}, ${customPickupCoords[1].toFixed(4)})`;
    } else {
      if (dropoffMode === 'preset') {
        const loc = WINDHOEK_LOCATIONS.find(l => l.id === dropoffId);
        return loc ? loc.name : 'Eros Airport';
      }
      return customDropoffName || `Custom Coordinates (${customDropoffCoords[0].toFixed(4)}, ${customDropoffCoords[1].toFixed(4)})`;
    }
  };

  // Search Autocomplete States
  const [pickupSearch, setPickupSearch] = useState('');
  const [dropoffSearch, setDropoffSearch] = useState('');
  const [isPickupFocused, setIsPickupFocused] = useState(false);
  const [isDropoffFocused, setIsDropoffFocused] = useState(false);

  // Sync inputs when not focused
  useEffect(() => {
    if (!isPickupFocused) {
      setPickupSearch(getSelectedName('pickup'));
    }
  }, [pickupId, pickupMode, customPickupName, customPickupCoords, isPickupFocused]);

  useEffect(() => {
    if (!isDropoffFocused) {
      setDropoffSearch(getSelectedName('dropoff'));
    }
  }, [dropoffId, dropoffMode, customDropoffName, customDropoffCoords, isDropoffFocused]);

  const filteredPickupLocations = WINDHOEK_LOCATIONS.filter(loc => 
    loc.name.toLowerCase().includes(pickupSearch.toLowerCase())
  );

  const filteredDropoffLocations = WINDHOEK_LOCATIONS.filter(loc => 
    loc.name.toLowerCase().includes(dropoffSearch.toLowerCase())
  );

  const handleSelectPickup = (loc) => {
    setPickupId(loc.id);
    setPickupMode('preset');
    setPickupSearch(loc.name);
    setIsPickupFocused(false);
  };

  const handleSelectDropoff = (loc) => {
    setDropoffId(loc.id);
    setDropoffMode('preset');
    setDropoffSearch(loc.name);
    setIsDropoffFocused(false);
  };

  // Recalculate default fare offer when parameters change
  useEffect(() => {
    const recommended = calculateFareEstimate(selectedTier);
    setOfferFare(recommended);
  }, [pickupId, dropoffId, pickupMode, dropoffMode, customPickupCoords, customDropoffCoords, selectedTier, weather, surgeMultiplier]);

  // Find active ride associated with passenger
  const activeRide = rides.find(r => r.id === passenger.activeRideId);
  const activeDriver = activeRide ? drivers.find(d => d.id === activeRide.driverId) : null;

  // Pre-calculate prices for dropdown display
  const pickupLoc = WINDHOEK_LOCATIONS.find(l => l.id === pickupId);
  const dropoffLoc = WINDHOEK_LOCATIONS.find(l => l.id === dropoffId);
  
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
            
            {/* Balance Card */}
            <div className="bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 rounded-lg">
              <span className="text-[8px] text-cyan-400 block uppercase font-bold">Wallet</span>
              <span className="text-xs font-bold text-white">N${passenger.balance.toFixed(2)}</span>
            </div>
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
                  customPickupCoords={pickupMode === 'custom' ? customPickupCoords : null}
                  customDropoffCoords={dropoffMode === 'custom' ? customDropoffCoords : null}
                />
              </div>

              {/* Location Selectors */}
              <div className="flex flex-col gap-3">
                <div className="glass-panel p-3 flex flex-col gap-3">
                  {/* Pickup Selection Block */}
                  <div className="flex flex-col gap-1.5 border-b border-white/5 pb-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Pickup Location</span>
                      <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5">
                        <button
                          onClick={() => setPickupMode('preset')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                            pickupMode === 'preset' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          Preset
                        </button>
                        <button
                          onClick={() => {
                            setPickupMode('custom');
                            setActiveSelectionField('pickup');
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                            pickupMode === 'custom' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          📍 Map Pin
                        </button>
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 p-1.5 rounded-lg transition-all ${
                      pickupMode === 'custom' && activeSelectionField === 'pickup' ? 'bg-cyan-500/10 border border-cyan-500/30' : 'border border-transparent'
                    }`}>
                      <MapPin size={14} className={pickupMode === 'custom' ? 'text-emerald-400 shrink-0' : 'text-cyan-400 shrink-0'} />
                      <div className="flex-1 min-w-0">
                        {pickupMode === 'preset' ? (
                          <div className="relative">
                            <input
                              type="text"
                              value={pickupSearch}
                              onChange={(e) => setPickupSearch(e.target.value)}
                              onFocus={() => setIsPickupFocused(true)}
                              onBlur={() => setTimeout(() => setIsPickupFocused(false), 200)}
                              placeholder="Search pickup spot..."
                              className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0"
                            />
                            {isPickupFocused && (
                              <div className="glass-panel absolute left-0 right-0 top-full mt-2 max-h-[140px] overflow-y-auto z-[2000] flex flex-col p-1 text-left">
                                {filteredPickupLocations.length > 0 ? (
                                  filteredPickupLocations.map(loc => (
                                    <button
                                      key={loc.id}
                                      onMouseDown={() => handleSelectPickup(loc)}
                                      className="text-[10px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                    >
                                      {loc.name}
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-[9px] text-text-muted p-2 text-center">No spots found</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 text-left">
                            <input
                              type="text"
                              placeholder="Name this custom pickup spot..."
                              value={customPickupName}
                              onChange={(e) => setCustomPickupName(e.target.value)}
                              className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full placeholder-white/25 p-0"
                            />
                            <div className="flex justify-between items-center text-[7px] text-text-muted font-mono leading-none">
                              <span>Coords: {customPickupCoords[0].toFixed(4)}, {customPickupCoords[1].toFixed(4)}</span>
                              {activeSelectionField === 'pickup' && <span className="text-emerald-400 animate-pulse">● Click Map to Drop Pin</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Dropoff Selection Block */}
                  <div className="flex flex-col gap-1.5 pt-0.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Dropoff Destination</span>
                      <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5">
                        <button
                          onClick={() => setDropoffMode('preset')}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                            dropoffMode === 'preset' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          Preset
                        </button>
                        <button
                          onClick={() => {
                            setDropoffMode('custom');
                            setActiveSelectionField('dropoff');
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                            dropoffMode === 'custom' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          📍 Map Pin
                        </button>
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 p-1.5 rounded-lg transition-all ${
                      dropoffMode === 'custom' && activeSelectionField === 'dropoff' ? 'bg-cyan-500/10 border border-cyan-500/30' : 'border border-transparent'
                    }`}>
                      <Compass size={14} className={dropoffMode === 'custom' ? 'text-pink-400 shrink-0' : 'text-pink-500 shrink-0'} />
                      <div className="flex-1 min-w-0">
                        {dropoffMode === 'preset' ? (
                          <div className="relative">
                            <input
                              type="text"
                              value={dropoffSearch}
                              onChange={(e) => setDropoffSearch(e.target.value)}
                              onFocus={() => setIsDropoffFocused(true)}
                              onBlur={() => setTimeout(() => setIsDropoffFocused(false), 200)}
                              placeholder="Search destination..."
                              className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full p-0"
                            />
                            {isDropoffFocused && (
                              <div className="glass-panel absolute left-0 right-0 top-full mt-2 max-h-[140px] overflow-y-auto z-[2000] flex flex-col p-1 text-left">
                                {filteredDropoffLocations.length > 0 ? (
                                  filteredDropoffLocations.map(loc => (
                                    <button
                                      key={loc.id}
                                      onMouseDown={() => handleSelectDropoff(loc)}
                                      className="text-[10px] text-white hover:bg-white/5 px-2 py-1.5 rounded transition-all text-left truncate hover:text-white"
                                    >
                                      {loc.name}
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-[9px] text-text-muted p-2 text-center">No destinations found</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 text-left">
                            <input
                              type="text"
                              placeholder="Name this custom dropoff spot..."
                              value={customDropoffName}
                              onChange={(e) => setCustomDropoffName(e.target.value)}
                              className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full placeholder-white/25 p-0"
                            />
                            <div className="flex justify-between items-center text-[7px] text-text-muted font-mono leading-none">
                              <span>Coords: {customDropoffCoords[0].toFixed(4)}, {customDropoffCoords[1].toFixed(4)}</span>
                              {activeSelectionField === 'dropoff' && <span className="text-pink-400 animate-pulse">● Click Map to Drop Pin</span>}
                            </div>
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
                  <span>Wallet Debit</span>
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

        </div>
      </div>
    </div>
  );
}
