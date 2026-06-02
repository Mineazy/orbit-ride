import React, { useState, useEffect } from 'react';
import { useSimulation, SF_LOCATIONS, VEHICLE_TIERS } from '../context/SimulationContext';
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
  const [pickupId, setPickupId] = useState('loc-union-sq');
  const [dropoffId, setDropoffId] = useState('loc-airport');
  const [selectedTier, setSelectedTier] = useState('OrbitX');
  
  // Rating states upon completion
  const [givenRating, setGivenRating] = useState(5);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  // Find active ride associated with passenger
  const activeRide = rides.find(r => r.id === passenger.activeRideId);
  const activeDriver = activeRide ? drivers.find(d => d.id === activeRide.driverId) : null;

  // Pre-calculate prices for dropdown display
  const pickupLoc = SF_LOCATIONS.find(l => l.id === pickupId);
  const dropoffLoc = SF_LOCATIONS.find(l => l.id === dropoffId);
  
  const calculateFareEstimate = (tier) => {
    if (!pickupLoc || !dropoffLoc) return 0;
    const lat1 = pickupLoc.coords[0];
    const lon1 = pickupLoc.coords[1];
    const lat2 = dropoffLoc.coords[0];
    const lon2 = dropoffLoc.coords[1];
    
    // Haversine formula
    const R = 3958.8; // miles
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
    return parseFloat(((config.base + config.perMile * dist) * surgeMultiplier * weatherFactor).toFixed(2));
  };

  const handleBookRide = () => {
    if (pickupId === dropoffId) return;
    requestRide(pickupLoc.coords, dropoffLoc.coords, pickupLoc.name, dropoffLoc.name, selectedTier);
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
              <span className="text-xs font-bold text-white">${passenger.balance.toFixed(2)}</span>
            </div>
          </div>

          {/* Booking State Flows */}

          {/* STATE A: Booking Setup Interface */}
          {!activeRide && (
            <div className="flex-1 flex flex-col justify-between">
              {/* Location Selectors */}
              <div className="flex flex-col gap-3">
                <div className="glass-panel p-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 border-b border-muted pb-2">
                    <MapPin size={14} className="text-cyan-400 shrink-0" />
                    <div className="flex-1">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Pickup Location</span>
                      <select 
                        value={pickupId} 
                        onChange={(e) => setPickupId(e.target.value)}
                        className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full cursor-pointer"
                      >
                        {SF_LOCATIONS.map(loc => (
                          <option key={loc.id} value={loc.id} className="bg-bg-surface-solid text-white text-xs">
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Compass size={14} className="text-pink-500 shrink-0" />
                    <div className="flex-1">
                      <span className="text-[8px] uppercase text-text-muted font-bold block">Dropoff Destination</span>
                      <select 
                        value={dropoffId} 
                        onChange={(e) => setDropoffId(e.target.value)}
                        className="bg-transparent border-none text-xs text-white font-semibold focus:outline-none w-full cursor-pointer"
                      >
                        {SF_LOCATIONS.map(loc => (
                          <option key={loc.id} value={loc.id} className="bg-bg-surface-solid text-white text-xs">
                            {loc.name}
                          </option>
                        ))}
                      </select>
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
                          <p className="text-xs font-bold text-cyan-300">${fare.toFixed(2)}</p>
                          <span className="text-[8px] text-text-muted">Est. 4 min</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Booking Button */}
              <button 
                onClick={handleBookRide}
                disabled={pickupId === dropoffId}
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
                      Fare locked at booking: <b className="text-cyan-400">${activeRide.fare.toFixed(2)}</b>
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
                  <span>${activeRide.fare.toFixed(2)}</span>
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
