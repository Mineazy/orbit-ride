import React, { useState, useEffect } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { 
  Navigation, Star, Award, DollarSign, Power, 
  MapPin, Compass, AlertTriangle, UserCheck, Play,
  Upload, Camera
} from 'lucide-react';
import MapView from './MapView';

// Helper to compress and resize images client-side using HTML Canvas
const compressAndResizeImage = (file, maxWidth = 150, maxHeight = 150) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export default function DriverApp() {
  const {
    drivers,
    rides,
    acceptRide,
    markArrived,
    startTrip,
    completeTrip,
    cancelRide,
    toggleDriverOnline,
    registerDriver,
    updateDriverAvatar
  } = useSimulation();

  const [onboardingTab, setOnboardingTab] = useState('register'); // register | quick-login
  const [selectedAvatarIdx, setSelectedAvatarIdx] = useState(0);
  const [newName, setNewName] = useState('');
  const [newCar, setNewCar] = useState('');
  const [newTier, setNewTier] = useState('OrbitX');
  const [customAvatar, setCustomAvatar] = useState(null); // base64 compressed string

  // Active driver identity selection state (default is empty, loaded from localStorage)
  const [activeDriverId, setActiveDriverId] = useState(() => {
    return localStorage.getItem('orbitride_active_driver_id') || '';
  });
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

  // Driver accepts request
  const handleAccept = () => {
    if (pendingRide && currentDriver) {
      acceptRide(currentDriver.id, pendingRide.id);
    }
  };

  // Get distance left (in km/points representation)
  const getDistanceLeft = () => {
    if (!activeRide) return 0;
    const totalPoints = activeRide.routePoints.length;
    const pointsLeft = totalPoints - activeRide.currentRouteIndex;
    return parseFloat((pointsLeft * 0.08).toFixed(1)); // mock decreasing distance
  };

  const getDriverNameForTier = (tier) => {
    if (tier === 'OrbitX') return 'Alex Mercer';
    if (tier === 'OrbitXL') return 'Elena Rostova';
    return 'Sarah Chen';
  };

  const isStandalone = import.meta.env.VITE_APP_ROLE === 'driver' || window.location.search.includes('role=driver');

  const presetAvatars = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80'
  ];

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

        {/* Header Display */}
        {isStandalone ? (
          <div className="px-4 py-3 bg-black/60 border-b border-white/5 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Orbit Driver</span>
            </div>
            <span className="text-[8px] font-mono text-text-muted">Live Dispatch</span>
          </div>
        ) : (
          /* Identity Login Selector at top for Matrix view */
          <div className="px-4 py-1.5 bg-black/50 border-b border-white/5 flex justify-between items-center text-[10px] shrink-0">
            <span className="text-text-muted">Operator Console:</span>
            <div className="flex items-center gap-1.5">
              <select 
                value={activeDriverId}
                onChange={(e) => {
                  const val = e.target.value;
                  setActiveDriverId(val);
                  if (val) {
                    localStorage.setItem('orbitride_active_driver_id', val);
                  } else {
                    localStorage.removeItem('orbitride_active_driver_id');
                  }
                }}
                className="bg-transparent border-none font-bold text-emerald-400 focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-bg-surface-solid text-white text-[10px]">-- Select Driver --</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id} className="bg-bg-surface-solid text-white text-[10px]">
                    {d.name} ({d.tier})
                  </option>
                ))}
              </select>
              <button 
                onClick={() => {
                  setActiveDriverId('');
                  localStorage.removeItem('orbitride_active_driver_id');
                  setOnboardingTab('register');
                }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold hover:bg-emerald-500/20 active:scale-95 transition-all"
              >
                + New
              </button>
            </div>
          </div>
        )}

        {/* Core Screen */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {!currentDriver ? (
            /* Welcome / Onboarding Screen */
            <div className="flex-grow flex flex-col justify-between py-2 text-left">
              <div>
                {/* Logo and header */}
                <div className="text-center my-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-400 to-teal-500 flex items-center justify-center text-black font-extrabold text-lg shadow-[0_0_15px_rgba(16,185,129,0.3)] mx-auto mb-2">
                    <Navigation size={22} className="fill-black" />
                  </div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Join Orbit Fleet</h3>
                  <p className="text-[10px] text-text-muted mt-0.5">Windhoek Dispatch Network Partner Portal</p>
                </div>

                {/* Tab Switcher */}
                <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 mb-4">
                  <button 
                    onClick={() => setOnboardingTab('register')}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all text-center ${
                      onboardingTab === 'register' ? 'bg-emerald-500 text-black' : 'text-text-muted hover:text-white'
                    }`}
                  >
                    Register New
                  </button>
                  <button 
                    onClick={() => setOnboardingTab('quick-login')}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all text-center ${
                      onboardingTab === 'quick-login' ? 'bg-emerald-500 text-black' : 'text-text-muted hover:text-white'
                    }`}
                  >
                    Quick Login
                  </button>
                </div>

                {onboardingTab === 'register' ? (
                  /* Registration Form */
                  <div className="flex flex-col gap-3">
                    {/* Name Input */}
                    <div>
                      <label className="text-[9px] text-text-muted uppercase font-bold block mb-1">Full Name</label>
                      <input 
                        type="text"
                        placeholder="e.g. Samuel Negumbo"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>

                    {/* Car Input */}
                    <div>
                      <label className="text-[9px] text-text-muted uppercase font-bold block mb-1">Vehicle Model & Color</label>
                      <input 
                        type="text"
                        placeholder="e.g. Volkswagen Golf (Blue)"
                        value={newCar}
                        onChange={(e) => setNewCar(e.target.value)}
                        className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>

                    {/* Vehicle Tier Select */}
                    <div>
                      <label className="text-[9px] text-text-muted uppercase font-bold block mb-1">Service Tier Type</label>
                      <select
                        value={newTier}
                        onChange={(e) => setNewTier(e.target.value)}
                        className="w-full bg-black/45 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 cursor-pointer"
                      >
                        <option value="OrbitX" className="bg-bg-surface-solid text-white text-xs">OrbitX (Economy)</option>
                        <option value="OrbitXL" className="bg-bg-surface-solid text-white text-xs">OrbitXL (Spacious SUV)</option>
                        <option value="OrbitFly" className="bg-bg-surface-solid text-white text-xs">OrbitFly (Premium Electric)</option>
                      </select>
                    </div>

                    {/* Preset Avatar Selection */}
                    <div>
                      <label className="text-[9px] text-text-muted uppercase font-bold block mb-1">Select Profile Avatar</label>
                      <div className="grid grid-cols-5 gap-2 mt-1">
                        {presetAvatars.map((url, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedAvatarIdx(idx);
                              setCustomAvatar(null);
                            }}
                            className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all ${
                              selectedAvatarIdx === idx && !customAvatar ? 'border-emerald-500 scale-105' : 'border-white/5 opacity-50 hover:opacity-80'
                            }`}
                          >
                            <img src={url} alt={`Avatar option ${idx + 1}`} className="w-full h-full object-cover animate-fade-in" />
                            {selectedAvatarIdx === idx && !customAvatar && (
                              <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                                <UserCheck size={14} className="text-white animate-scale-up" />
                              </div>
                            )}
                          </button>
                        ))}

                        {/* Custom Avatar Upload Button */}
                        <label
                          className={`relative rounded-lg overflow-hidden border-2 border-dashed aspect-square transition-all flex flex-col items-center justify-center cursor-pointer ${
                            customAvatar ? 'border-emerald-500 scale-105' : 'border-white/10 hover:border-white/25 hover:bg-white/5'
                          }`}
                        >
                          {customAvatar ? (
                            <>
                              <img src={customAvatar} alt="Custom upload" className="w-full h-full object-cover animate-fade-in" />
                              <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                                <UserCheck size={14} className="text-white animate-scale-up" />
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-center p-0.5">
                              <Upload size={14} className="text-emerald-400" />
                              <span className="text-[7px] text-text-muted mt-0.5 leading-none">Upload</span>
                            </div>
                          )}
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                try {
                                  const compressed = await compressAndResizeImage(file);
                                  setCustomAvatar(compressed);
                                  setSelectedAvatarIdx(-1);
                                } catch (err) {
                                  console.error('Failed to compress avatar:', err);
                                }
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        if (!newName.trim() || !newCar.trim()) return;
                        const avatarToUse = customAvatar || presetAvatars[selectedAvatarIdx];
                        const newDriverId = await registerDriver(newName, newCar, newTier, avatarToUse);
                        setActiveDriverId(newDriverId);
                        localStorage.setItem('orbitride_active_driver_id', newDriverId);
                        setNewName('');
                        setNewCar('');
                        setSelectedAvatarIdx(0);
                        setCustomAvatar(null);
                      }}
                      disabled={!newName.trim() || !newCar.trim()}
                      className="btn-primary w-full py-2.5 justify-center bg-emerald-500 text-black font-bold text-xs tracking-wider uppercase mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Create Profile & Start
                    </button>
                  </div>
                ) : (
                  /* Quick Login Mode */
                  <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                    <p className="text-[10px] text-text-muted mb-1 text-center">Select an existing partner profile to quick-start simulation.</p>
                    {drivers.map(d => (
                      <button
                        key={d.id}
                        onClick={() => {
                          setActiveDriverId(d.id);
                          localStorage.setItem('orbitride_active_driver_id', d.id);
                        }}
                        className="glass-panel p-2.5 flex justify-between items-center border border-white/5 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all text-left"
                      >
                        <div className="flex items-center gap-2">
                          <img src={d.avatar} alt={d.name} className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-white leading-tight">{d.name}</p>
                            <p className="text-[9px] text-text-muted mt-0.5">{d.car} • <b className="text-emerald-400 font-mono text-[8px]">{d.tier}</b></p>
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          <div className="flex items-center gap-0.5 text-[9px] text-amber-400 font-bold leading-none">
                            <Star size={9} className="fill-amber-400" />
                            <span>{d.rating}</span>
                          </div>
                          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold rounded">Log In</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Main Driver Console Content */
            <>
              {/* Driver Stats summary */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <label className="relative group cursor-pointer w-8 h-8 rounded-full overflow-hidden border border-emerald-500/30 shrink-0 block">
                    <img 
                      src={currentDriver.avatar} 
                      alt={currentDriver.name} 
                      className="w-full h-full object-cover transition-all group-hover:scale-110 group-hover:brightness-50"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                      <Camera size={12} className="text-emerald-400 animate-scale-up" />
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const compressed = await compressAndResizeImage(file);
                            updateDriverAvatar(currentDriver.id, compressed);
                          } catch (err) {
                            console.error('Failed to compress profile photo:', err);
                          }
                        }
                      }}
                    />
                  </label>
                  <div>
                    <p className="text-xs font-bold text-white leading-tight">{currentDriver.name}</p>
                    <div className="flex items-center gap-1">
                      <Star size={8} className="fill-emerald-400 text-emerald-400" />
                      <span className="text-[9px] text-text-muted">{currentDriver.rating} Rating</span>
                    </div>
                  </div>
                </div>

                {/* Earnings & Logout metric */}
                <div className="flex flex-col items-end">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
                    <span className="text-[8px] text-emerald-400 block uppercase font-bold">Earnings</span>
                    <span className="text-xs font-bold text-white">N${currentDriver.earnings.toFixed(2)}</span>
                  </div>
                  <button 
                    onClick={() => {
                      setActiveDriverId('');
                      localStorage.removeItem('orbitride_active_driver_id');
                    }}
                    className="text-[9px] text-text-muted underline mt-1 hover:text-white"
                  >
                    Logout / Switch
                  </button>
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
                        <span className="text-xl font-extrabold text-white">N${pendingRide.fare.toFixed(2)}</span>
                        <span className="text-[8px] text-text-muted block mt-0.5">Your Payout (80%): <b className="text-emerald-400">N${(pendingRide.fare * 0.8).toFixed(2)}</b></span>
                      </div>
                      <div className="text-right">
                        <span className="text-[8px] text-text-muted block uppercase font-bold">Distance</span>
                        <span className="text-xs font-bold text-white">{pendingRide.distance} km</span>
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
                          <span className="text-white font-semibold">{getDistanceLeft()} km left</span>
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
            </>
          )}

        </div>
      </div>
    </div>
  );
}
