import React, { useState, useEffect } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { 
  Navigation, Star, Award, DollarSign, Power, 
  MapPin, Compass, AlertTriangle, UserCheck, Play 
} from 'lucide-react';
import MapView from './MapView';

export default function DriverApp() {
  const {
    drivers,
    rides,
    acceptRide,
    markArrived,
    startTrip,
    completeTrip,
    cancelRide,
    toggleDriverOnline
  } = useSimulation();

  // Active driver identity selection state (default is Elena: driver-1)
  const [activeDriverId, setActiveDriverId] = useState('driver-1');
  const [countdown, setCountdown] = useState(10);

  // Find active driver details from the context
  const currentDriver = drivers.find(d => d.id === activeDriverId);

  // Find if there is an active ride assigned to this driver
  const activeRide = rides.find(r => 
    r.driverId === activeDriverId && 
    (r.status === 'ACCEPTED' || r.status === 'ARRIVED' || r.status === 'IN_PROGRESS')
  );

  // Find if there are any pending requested rides matching the driver's tier (Bid queue)
  const pendingRide = rides.find(r => 
    r.status === 'REQUESTED' && 
    r.tier === currentDriver?.tier
  );

  const anyRequestedRide = rides.find(r => r.status === 'REQUESTED');

  // Bid timer effect
  useEffect(() => {
    let timer;
    if (pendingRide && currentDriver?.status === 'ONLINE_IDLE') {
      setCountdown(10);
      timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Cancel ride on timeout
            cancelRide(pendingRide.id);
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [pendingRide, currentDriver?.status]);

  if (!currentDriver) return null;

  // Driver accepts request
  const handleAccept = () => {
    if (pendingRide) {
      acceptRide(currentDriver.id, pendingRide.id);
    }
  };

  // Get distance left (in miles/points representation)
  const getDistanceLeft = () => {
    if (!activeRide) return 0;
    const totalPoints = activeRide.routePoints.length;
    const pointsLeft = totalPoints - activeRide.currentRouteIndex;
    return parseFloat((pointsLeft * 0.05).toFixed(1)); // mock decreasing distance
  };

  const getDriverNameForTier = (tier) => {
    if (tier === 'OrbitX') return 'Alex Mercer';
    if (tier === 'OrbitXL') return 'Elena Rostova';
    return 'Sarah Chen';
  };

  const isStandalone = import.meta.env.VITE_APP_ROLE === 'driver' || window.location.search.includes('role=driver');

  return (
    <div className={isStandalone ? "flex flex-col h-screen w-screen bg-[#06060c] text-white" : "mobile-frame"}>
      <div className={isStandalone ? "flex-1 flex flex-col h-full w-full" : "mobile-screen"}>
        {!isStandalone && (
          /* Status Bar */
          <div className="status-bar">
            <span>14:35</span>
            <div className="status-icons">
              <Power size={10} className="text-emerald-400" />
              <span>5G</span>
              <span>🔋 92%</span>
            </div>
          </div>
        )}

        {/* Identity Login Selector at top */}
        <div className="px-4 py-1.5 bg-black/50 border-b border-white/5 flex justify-between items-center text-[10px]">
          <span className="text-text-muted">Operator Console:</span>
          <select 
            value={activeDriverId}
            onChange={(e) => setActiveDriverId(e.target.value)}
            className="bg-transparent border-none font-bold text-emerald-400 focus:outline-none cursor-pointer"
          >
            {drivers.map(d => (
              <option key={d.id} value={d.id} className="bg-bg-surface-solid text-white text-[10px]">
                {d.name} ({d.tier})
              </option>
            ))}
          </select>
        </div>

        {/* Core Screen */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {/* Driver Stats summary */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <img 
                src={currentDriver.avatar} 
                alt={currentDriver.name} 
                className="w-8 h-8 rounded-full border border-emerald-500/30 object-cover"
              />
              <div>
                <p className="text-xs font-bold text-white leading-tight">{currentDriver.name}</p>
                <div className="flex items-center gap-1">
                  <Star size={8} className="fill-emerald-400 text-emerald-400" />
                  <span className="text-[9px] text-text-muted">{currentDriver.rating} Rating</span>
                </div>
              </div>
            </div>

            {/* Earnings metric */}
            <div className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
              <span className="text-[8px] text-emerald-400 block uppercase font-bold">Earnings</span>
              <span className="text-xs font-bold text-white">${currentDriver.earnings.toFixed(2)}</span>
            </div>
          </div>

          {/* ONLINE/OFFLINE SWITCH CONTROL PANEL */}
          {currentDriver.status === 'OFFLINE' && !activeRide && (
            <div className="flex-1 flex flex-col justify-between items-center py-8 text-center">
              <div className="my-auto">
                <div className="w-14 h-14 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto mb-4">
                  <Power size={24} className="text-danger" />
                </div>
                <h4 className="text-sm font-bold text-white">Console Offline</h4>
                
                {anyRequestedRide ? (
                  <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-300 mt-2 font-medium">
                    {anyRequestedRide.tier === currentDriver.tier ? (
                      `⚠️ Client waiting for ${currentDriver.tier}! Click GO ONLINE to accept.`
                    ) : (
                      `⚠️ Client waiting for ${anyRequestedRide.tier}. Switch dropdown above to ${getDriverNameForTier(anyRequestedRide.tier)}.`
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted max-w-[200px] mt-1 mx-auto">
                    Go online to request simulation jobs and sync with dispatcher maps.
                  </p>
                )}
              </div>

              <button 
                onClick={() => toggleDriverOnline(currentDriver.id)}
                className="btn-primary w-full bg-emerald-500 hover:bg-emerald-600 hover:box-shadow-emerald text-black py-2.5 text-xs font-bold justify-center"
              >
                GO ONLINE
              </button>
            </div>
          )}

          {/* ONLINE IDLE (WAITING QUEUE) */}
          {currentDriver.status === 'ONLINE_IDLE' && !pendingRide && !activeRide && (
            <div className="flex-1 flex flex-col justify-between items-center py-8 text-center">
              <div className="my-auto">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 pulse-glowing-emerald">
                  <Compass size={24} className="text-emerald-400 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <h4 className="text-sm font-bold text-white">Online & Queueing</h4>
                
                {anyRequestedRide ? (
                  <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-300 mt-2 font-medium">
                    {`⚠️ Active request for ${anyRequestedRide.tier}. Switch dropdown above to ${getDriverNameForTier(anyRequestedRide.tier)} to accept.`}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted max-w-[180px] mt-1 mx-auto">
                    Searching for requests matching tier <b className="text-emerald-400 font-mono">{currentDriver.tier}</b>...
                  </p>
                )}
              </div>

              <button 
                onClick={() => toggleDriverOnline(currentDriver.id)}
                className="btn-secondary w-full border-danger/25 hover:bg-danger/5 text-danger py-2 text-xs justify-center"
              >
                Go Offline
              </button>
            </div>
          )}

          {/* INCOMING REQUEST BIDS SCREEN */}
          {currentDriver.status === 'ONLINE_IDLE' && pendingRide && (
            <div className="flex-1 flex flex-col justify-between items-center py-2">
              <div className="glass-panel p-4 w-full border border-amber-500/20 text-center animate-pulse">
                <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">New Ride Bid</div>
                <div className="text-xs text-text-muted mt-0.5">Accept job assignment within</div>
                <div className="text-3xl font-extrabold text-white my-1">{countdown}s</div>
              </div>

              {/* Ride metadata card */}
              <div className="glass-panel p-3 w-full mt-4 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-[8px] text-emerald-400 block uppercase font-bold tracking-wider">Passenger Offer</span>
                    <span className="text-xl font-extrabold text-white">${pendingRide.fare.toFixed(2)}</span>
                    <span className="text-[8px] text-text-muted block mt-0.5">Your Payout (80%): <b className="text-emerald-400">${(pendingRide.fare * 0.8).toFixed(2)}</b></span>
                  </div>
                  <div className="text-right">
                    <span className="text-[8px] text-text-muted block uppercase font-bold">Distance</span>
                    <span className="text-xs font-bold text-white">{pendingRide.distance} miles</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-white/5 text-[10px] text-left">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={10} className="text-cyan-400 shrink-0" />
                    <span className="text-white truncate"><b>Pickup:</b> {pendingRide.pickupName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Compass size={10} className="text-pink-400 shrink-0" />
                    <span className="text-white truncate"><b>Dropoff:</b> {pendingRide.dropoffName}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 w-full mt-auto">
                <button 
                  onClick={() => cancelRide(pendingRide.id)}
                  className="btn-secondary py-2.5 text-xs text-danger border-danger/20 justify-center"
                >
                  Decline
                </button>
                <button 
                  onClick={handleAccept}
                  className="btn-primary py-2.5 text-xs text-black bg-emerald-400 justify-center"
                >
                  ACCEPT TRIP
                </button>
              </div>
            </div>
          )}

          {/* ACTIVE TRIP CHECKPOINTS */}
          {activeRide && (
            <div className="flex-grow flex flex-col justify-between h-full">
              {/* Live Navigation Map inside Driver viewport */}
              <div className="w-full h-[180px] rounded-xl overflow-hidden mb-3 border border-white/5 shrink-0" style={{ position: 'relative', height: '180px' }}>
                <MapView height="100%" width="100%" showLocations={false} zoomControl={false} fitRideId={activeRide.id} />
              </div>

              {/* Navigation status directions */}
              <div className="flex-1 flex flex-col justify-between">
                <div className="glass-panel p-2.5 border-l-4 border-l-emerald-400">
                  <span className="text-[9px] uppercase tracking-wide text-text-muted font-bold block">
                    {activeRide.status === 'ACCEPTED' ? 'Drive to Passenger' : 
                     activeRide.status === 'ARRIVED' ? 'Awaiting Passenger boarding' : 'Drive to dropoff'}
                  </span>
                  
                  <p className="text-xs font-bold text-white mt-1 truncate">
                    {activeRide.status === 'ACCEPTED' ? activeRide.pickupName : activeRide.dropoffName}
                  </p>

                  <div className="flex justify-between items-center text-[10px] mt-2.5 pt-2 border-t border-white/5">
                    <div className="flex items-center gap-1">
                      <Navigation size={12} className="text-emerald-400 animate-pulse" />
                      <span className="text-white font-semibold">{getDistanceLeft()} mi left</span>
                    </div>
                    <span className="text-text-muted font-mono">{activeRide.tier} Job</span>
                  </div>
                </div>

                {/* Context Action Button based on Trip phase */}
                <div className="mt-auto flex flex-col gap-2">
                  {activeRide.status === 'ACCEPTED' && (
                    <button 
                      onClick={() => markArrived(activeRide.id)}
                      className="btn-primary w-full py-2.5 bg-amber-400 hover:bg-amber-500 hover:box-shadow-amber text-black justify-center font-bold text-xs"
                    >
                      MARK ARRIVED
                    </button>
                  )}

                  {activeRide.status === 'ARRIVED' && (
                    <button 
                      onClick={() => startTrip(activeRide.id)}
                      className="btn-primary w-full py-2.5 bg-emerald-400 text-black justify-center font-bold text-xs"
                    >
                      START TRIP / PASSENGER BOARDED
                    </button>
                  )}

                  {activeRide.status === 'IN_PROGRESS' && (
                    <button 
                      onClick={() => completeTrip(activeRide.id, 5)}
                      className="btn-primary w-full py-2.5 bg-cyan-400 text-black justify-center font-bold text-xs"
                    >
                      COMPLETE TRIP / COLLECT FARE
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
