// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { useSimulation, VEHICLE_TIERS } from '../context/SimulationContext';
import { 
  Navigation, Star, Power, 
  Compass, AlertTriangle, UserCheck,
  Camera, ChevronLeft, ChevronRight, Check, DollarSign
} from 'lucide-react';
import MapView from './LazyMapView';
import Avatar from './Avatar';
import { polylineLength } from '../utils/roadRouter';

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

  const [onboardingStep, setOnboardingStep] = useState('welcome'); // welcome | profile | vehicle | review | login
  const [selectedAvatarIdx, setSelectedAvatarIdx] = useState(0);
  const [newName, setNewName] = useState('');
  const [newCar, setNewCar] = useState('');
  const [newTier, setNewTier] = useState('OrbitX');
  const [customAvatar, setCustomAvatar] = useState(null); // base64 compressed string

  // Active driver identity selection state (default is empty, loaded from localStorage)
  const [activeDriverId, setActiveDriverId] = useState(() => {
    return localStorage.getItem('orbitride_active_driver_id') || '';
  });

  // First visit only: log in as the first roster driver so the demo isn't empty. After that an empty
  // stored id means "signed out", which must show onboarding instead of logging straight back in.
  const firstVisit = useRef(null);
  if (firstVisit.current === null) firstVisit.current = localStorage.getItem('orbitride_active_driver_id') === null;
  useEffect(() => {
    if (firstVisit.current && !activeDriverId && drivers.length > 0) {
      firstVisit.current = false;
      const firstId = drivers[0].id;
      setActiveDriverId(firstId);
      localStorage.setItem('orbitride_active_driver_id', firstId);
    }
  }, [drivers, activeDriverId]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset bid countdown when a new request arrives
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

  // Street distance still to drive on the active route, in km
  const getDistanceLeft = () => {
    if (!activeRide) return 0;
    return parseFloat((polylineLength(activeRide.routePoints.slice(activeRide.currentRouteIndex)) / 1000).toFixed(1));
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
            <span className="text-text-muted shrink-0">Operator</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <select 
                value={activeDriverId}
                onChange={(e) => {
                  const val = e.target.value;
                  setActiveDriverId(val);
                  if (val) {
                    localStorage.setItem('orbitride_active_driver_id', val);
                  } else {
                    localStorage.setItem('orbitride_active_driver_id', '');
                  }
                }}
                className="bg-transparent border-none font-bold text-emerald-400 focus:outline-none cursor-pointer min-w-0 max-w-[150px] truncate"
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
                  localStorage.setItem('orbitride_active_driver_id', '');
                  setOnboardingStep('profile');
                }}
                className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold whitespace-nowrap shrink-0 hover:bg-emerald-500/20 active:scale-95 transition-all"
              >
                + New
              </button>
            </div>
          </div>
        )}

        {/* Core Screen */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {!currentDriver ? (
            /* Driver onboarding: welcome -> profile -> vehicle -> review (or quick log-in) */
            (() => {
              const steps = ['profile', 'vehicle', 'review'];
              const stepIdx = steps.indexOf(onboardingStep);
              const nameOk = newName.trim().length >= 2;
              const carOk = newCar.trim().length >= 3;
              const avatarToUse = customAvatar || presetAvatars[selectedAvatarIdx] || presetAvatars[0];
              const tierInfo = VEHICLE_TIERS[newTier];

              const finish = async () => {
                if (!nameOk || !carOk) return;
                const newDriverId = await registerDriver(newName.trim(), newCar.trim(), newTier, avatarToUse);
                setActiveDriverId(newDriverId);
                localStorage.setItem('orbitride_active_driver_id', newDriverId);
                setNewName('');
                setNewCar('');
                setNewTier('OrbitX');
                setSelectedAvatarIdx(0);
                setCustomAvatar(null);
                setOnboardingStep('welcome');
              };

              const fieldClass = 'w-full bg-black/45 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/60 transition-colors';

              /* ---------- Welcome ---------- */
              if (onboardingStep === 'welcome') {
                return (
                  <div className="flex-1 flex flex-col min-h-0 gap-4 text-left">
                    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5">
                      <div className="text-center pt-3">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-500 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.35)] mx-auto mb-3 animate-map-reveal">
                          <Navigation size={26} className="fill-black text-black" />
                        </div>
                        <h3 className="text-lg font-extrabold text-white leading-tight">Drive with Orbit</h3>
                        <p className="text-xs text-text-muted mt-1 max-w-[220px] mx-auto leading-relaxed">
                          Join Windhoek's dispatch network and start earning in minutes.
                        </p>
                      </div>

                      <ul className="flex flex-col gap-2.5">
                        {[
                          { icon: DollarSign, title: 'Keep 80% of every fare', text: 'Paid out to your earnings after each trip.' },
                          { icon: Compass, title: 'Choose your ride tier', text: 'Economy, SUV or premium electric.' },
                          { icon: Power, title: 'Go online whenever you like', text: 'No schedules, accept the jobs you want.' },
                        ].map(({ icon: Icon, title, text }) => (
                          <li key={title} className="flex items-center gap-3 glass-panel p-3">
                            <span className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
                              <Icon size={16} className="text-emerald-400" />
                            </span>
                            <span className="min-w-0">
                              <span className="text-xs font-bold text-white block leading-tight">{title}</span>
                              <span className="text-[11px] text-text-muted block mt-0.5">{text}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="shrink-0 flex flex-col gap-2">
                      <button
                        onClick={() => setOnboardingStep('profile')}
                        className="btn-primary w-full py-3 justify-center bg-emerald-500 text-black font-bold text-sm"
                      >
                        Get started
                      </button>
                      {drivers.length > 0 && (
                        <button
                          onClick={() => setOnboardingStep('login')}
                          className="btn-secondary w-full py-2.5 text-xs justify-center"
                        >
                          I already have a profile
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              /* ---------- Quick log-in ---------- */
              if (onboardingStep === 'login') {
                return (
                  <div className="flex-1 flex flex-col min-h-0 gap-3 text-left">
                    <div>
                      <h3 className="text-md font-bold text-white">Welcome back</h3>
                      <p className="text-[11px] text-text-muted mt-0.5">Choose your partner profile to continue.</p>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
                      {drivers.map(d => (
                        <button
                          key={d.id}
                          onClick={() => {
                            setActiveDriverId(d.id);
                            localStorage.setItem('orbitride_active_driver_id', d.id);
                          }}
                          className="glass-panel p-3 flex items-center gap-3 border border-white/5 hover:border-emerald-500/30 hover:bg-emerald-500/5 active:scale-[0.99] transition-all text-left"
                        >
                          <Avatar src={d.avatar} name={d.name} className="w-10 h-10 rounded-full border border-white/10 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-white block leading-tight truncate">{d.name}</span>
                            <span className="text-[11px] text-text-muted block mt-0.5 truncate">{d.car}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="flex items-center justify-end gap-0.5 text-[11px] text-amber-400 font-bold">
                              <Star size={10} className="fill-amber-400" />{d.rating}
                            </span>
                            <span className="text-[10px] text-emerald-400 font-mono font-bold">{d.tier}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setOnboardingStep('welcome')} className="btn-secondary w-full py-2.5 text-xs justify-center shrink-0 gap-1">
                      <ChevronLeft size={14} /> Back
                    </button>
                  </div>
                );
              }

              /* ---------- Registration steps ---------- */
              return (
                <div className="flex-1 flex flex-col min-h-0 gap-3 text-left">
                  {/* Progress */}
                  <div aria-label={`Step ${stepIdx + 1} of 3`}>
                    <div className="flex gap-1.5">
                      {steps.map((s, i) => (
                        <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${i <= stepIdx ? 'bg-emerald-400' : 'bg-white/10'}`}></div>
                      ))}
                    </div>
                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider mt-1.5 block">Step {stepIdx + 1} of 3</span>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
                    {/* Step 1: profile */}
                    {onboardingStep === 'profile' && (
                      <>
                        <div>
                          <h3 className="text-md font-bold text-white">Your profile</h3>
                          <p className="text-[11px] text-text-muted mt-0.5">Passengers see your name and photo.</p>
                        </div>

                        <div className="flex flex-col items-center gap-3">
                          <label className="relative cursor-pointer group" title="Upload a photo">
                            <Avatar
                              src={avatarToUse}
                              name={newName.trim()}
                              className="w-20 h-20 rounded-full border-2 border-emerald-500/50"
                            />
                            <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-emerald-500 text-black flex items-center justify-center border-2 border-[var(--bg-deep)] group-hover:scale-110 transition-transform">
                              <Camera size={13} />
                            </span>
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
                          <div className="flex gap-2" role="radiogroup" aria-label="Choose a profile photo">
                            {presetAvatars.map((url, idx) => {
                              const selected = selectedAvatarIdx === idx && !customAvatar;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  aria-label={`Photo option ${idx + 1}`}
                                  onClick={() => {
                                    setSelectedAvatarIdx(idx);
                                    setCustomAvatar(null);
                                  }}
                                  className={`w-11 h-11 rounded-full overflow-hidden border-2 transition-all active:scale-90 ${
                                    selected ? 'border-emerald-400 scale-105' : 'border-white/10 opacity-60 hover:opacity-100'
                                  }`}
                                >
                                  <Avatar src={url} className="w-full h-full" />
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label htmlFor="driver-name" className="text-[11px] text-text-muted uppercase font-bold tracking-wider block mb-1.5">Full name</label>
                          <input
                            id="driver-name"
                            type="text"
                            autoComplete="name"
                            placeholder="e.g. Samuel Negumbo"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className={fieldClass}
                          />
                          {newName.length > 0 && !nameOk && (
                            <p className="text-[11px] text-amber-400 mt-1">Enter at least 2 characters.</p>
                          )}
                        </div>
                      </>
                    )}

                    {/* Step 2: vehicle */}
                    {onboardingStep === 'vehicle' && (
                      <>
                        <div>
                          <h3 className="text-md font-bold text-white">Your vehicle</h3>
                          <p className="text-[11px] text-text-muted mt-0.5">This decides which ride requests you receive.</p>
                        </div>

                        <div>
                          <label htmlFor="driver-car" className="text-[11px] text-text-muted uppercase font-bold tracking-wider block mb-1.5">Model and colour</label>
                          <input
                            id="driver-car"
                            type="text"
                            placeholder="e.g. Volkswagen Golf (Blue)"
                            value={newCar}
                            onChange={(e) => setNewCar(e.target.value)}
                            className={fieldClass}
                          />
                          {newCar.length > 0 && !carOk && (
                            <p className="text-[11px] text-amber-400 mt-1">Enter at least 3 characters.</p>
                          )}
                        </div>

                        <div>
                          <span className="text-[11px] text-text-muted uppercase font-bold tracking-wider block mb-1.5">Service tier</span>
                          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Service tier">
                            {Object.keys(VEHICLE_TIERS).map(tier => {
                              const info = VEHICLE_TIERS[tier];
                              const selected = newTier === tier;
                              return (
                                <button
                                  key={tier}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  onClick={() => setNewTier(tier)}
                                  className={`flex items-center gap-3 rounded-xl p-3 border text-left transition-all active:scale-[0.99] ${
                                    selected ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/5 bg-white/5 hover:border-white/15'
                                  }`}
                                >
                                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-emerald-400' : 'border-white/30'}`}>
                                    {selected && <span className="w-2 h-2 rounded-full bg-emerald-400"></span>}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="text-xs font-bold text-white block leading-tight">{info.name} <span className="text-text-muted font-medium">· {info.label}</span></span>
                                    <span className="text-[11px] text-text-muted block mt-0.5">From N${info.base.toFixed(2)} + N${info.perKm.toFixed(2)}/km</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Step 3: review */}
                    {onboardingStep === 'review' && (
                      <>
                        <div>
                          <h3 className="text-md font-bold text-white">Looks good?</h3>
                          <p className="text-[11px] text-text-muted mt-0.5">Check your details before you join.</p>
                        </div>

                        <div className="glass-panel p-3 flex items-center gap-3">
                          <Avatar src={avatarToUse} name={newName.trim()} className="w-14 h-14 rounded-full border border-emerald-500/40 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white leading-tight truncate">{newName.trim()}</p>
                            <p className="text-[11px] text-text-muted mt-0.5 truncate">{newCar.trim()}</p>
                            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-400 font-mono font-bold">
                              {tierInfo.name} · {tierInfo.label}
                            </span>
                          </div>
                        </div>

                        <div className="glass-panel p-3 flex items-start gap-3 border-l-4 border-l-emerald-400">
                          <DollarSign size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-text-muted leading-relaxed">
                            You keep <b className="text-white">80%</b> of every fare. You start offline and choose when to go online.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Pinned navigation */}
                  <div className="shrink-0 flex gap-2">
                    <button
                      onClick={() => setOnboardingStep(stepIdx === 0 ? 'welcome' : steps[stepIdx - 1])}
                      className="btn-secondary px-4 py-3 text-xs justify-center"
                      aria-label="Back"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    {onboardingStep === 'review' ? (
                      <button
                        onClick={finish}
                        className="btn-primary flex-1 py-3 justify-center bg-emerald-500 text-black font-bold text-sm"
                      >
                        <Check size={16} /> Create profile
                      </button>
                    ) : (
                      <button
                        onClick={() => setOnboardingStep(steps[stepIdx + 1])}
                        disabled={onboardingStep === 'profile' ? !nameOk : !carOk}
                        className="btn-primary flex-1 py-3 justify-center bg-emerald-500 text-black font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Continue <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            /* Main Driver Console Content */
            <>
              {/* Driver Stats summary */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <label className="relative group cursor-pointer w-8 h-8 rounded-full overflow-hidden border border-emerald-500/30 shrink-0 block">
                    <Avatar
                      src={currentDriver.avatar}
                      name={currentDriver.name}
                      className="w-full h-full transition-all group-hover:scale-110 group-hover:brightness-50"
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
                      localStorage.setItem('orbitride_active_driver_id', '');
                    }}
                    className="text-[9px] text-text-muted underline mt-1 hover:text-white"
                  >
                    Logout / Switch
                  </button>
                </div>
              </div>


              {/* ONLINE/OFFLINE SWITCH CONTROL PANEL */}
              {currentDriver?.status === 'OFFLINE' && !activeRide && (
                <div className="flex-1 flex flex-col min-h-0 gap-3">
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 min-h-0">
                    <div className="w-16 h-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center">
                      <Power size={26} className="text-danger" />
                    </div>
                    <div>
                      <h4 className="text-md font-bold text-white">You're offline</h4>
                      {!anyRequestedRide && (
                        <p className="text-xs text-text-muted max-w-[210px] mt-1 mx-auto leading-relaxed">
                          Go online to receive ride requests and appear on the dispatcher map.
                        </p>
                      )}
                    </div>

                    {anyRequestedRide && (
                      <div className="p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-300 font-medium text-left w-full flex gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-px" />
                        <span>
                          {anyRequestedRide.tier === currentDriver?.tier
                            ? `A client is waiting for ${currentDriver?.tier}. Go online to accept.`
                            : `A client is waiting for ${anyRequestedRide.tier}. Switch the operator above to ${getDriverNameForTier(anyRequestedRide.tier)}.`}
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 w-full">
                      <div className="rounded-xl bg-white/5 border border-white/5 p-2">
                        <span className="text-[10px] text-text-muted uppercase font-bold block">Tier</span>
                        <span className="text-xs font-bold text-emerald-400">{currentDriver?.tier}</span>
                      </div>
                      <div className="rounded-xl bg-white/5 border border-white/5 p-2">
                        <span className="text-[10px] text-text-muted uppercase font-bold block">Rating</span>
                        <span className="text-xs font-bold text-white">{currentDriver?.rating}</span>
                      </div>
                      <div className="rounded-xl bg-white/5 border border-white/5 p-2 min-w-0">
                        <span className="text-[10px] text-text-muted uppercase font-bold block">Vehicle</span>
                        <span className="text-xs font-bold text-white block truncate">{currentDriver?.car?.split(' (')[0]}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => currentDriver && toggleDriverOnline(currentDriver.id)}
                    className="btn-primary w-full bg-emerald-500 hover:bg-emerald-600 hover:box-shadow-emerald text-black py-3 text-sm font-bold justify-center shrink-0"
                  >
                    GO ONLINE
                  </button>
                </div>
              )}

              {/* ONLINE IDLE (WAITING QUEUE) */}
              {currentDriver?.status === 'ONLINE_IDLE' && !pendingRide && !activeRide && (
                <div className="flex-1 flex flex-col min-h-0 gap-3">
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 min-h-0">
                    <div className="relative w-20 h-20 flex items-center justify-center">
                      <span className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping"></span>
                      <span className="absolute inset-2 rounded-full border border-emerald-500/30"></span>
                      <div className="relative w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center pulse-glowing-emerald">
                        <Compass size={24} className="text-emerald-400 animate-spin" style={{ animationDuration: '6s' }} />
                      </div>
                    </div>
                    <div>
                      <h4 className="text-md font-bold text-white">You're online</h4>
                      {!anyRequestedRide && (
                        <p className="text-xs text-text-muted max-w-[210px] mt-1 mx-auto leading-relaxed">
                          Looking for <b className="text-emerald-400 font-mono">{currentDriver?.tier}</b> requests nearby...
                        </p>
                      )}
                    </div>
                    {anyRequestedRide && (
                      <div className="p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-300 font-medium text-left w-full flex gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-px" />
                        <span>{`Active request for ${anyRequestedRide.tier}. Switch the operator above to ${getDriverNameForTier(anyRequestedRide.tier)} to accept.`}</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => currentDriver && toggleDriverOnline(currentDriver.id)}
                    className="btn-secondary w-full border-danger/25 hover:bg-danger/5 text-danger py-2.5 text-xs justify-center shrink-0"
                  >
                    Go Offline
                  </button>
                </div>
              )}

              {/* INCOMING REQUEST BIDS SCREEN */}
              {currentDriver.status === 'ONLINE_IDLE' && pendingRide && (
                <div className="flex-1 flex flex-col min-h-0 gap-3">
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                    {/* Countdown ring */}
                    <div className="flex items-center gap-3 glass-panel p-3 border border-amber-500/20">
                      <div className="relative w-14 h-14 shrink-0">
                        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                          <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/10" />
                          <circle
                            cx="40" cy="40" r="34" fill="none" strokeWidth="6" strokeLinecap="round"
                            stroke="#fbbf24"
                            strokeDasharray={2 * Math.PI * 34}
                            strokeDashoffset={2 * Math.PI * 34 * (1 - countdown / 10)}
                            style={{ transition: 'stroke-dashoffset 1s linear' }}
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-white">{countdown}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">New ride request</div>
                        <div className="text-xs text-text-muted mt-0.5">Accept before the timer runs out</div>
                      </div>
                    </div>

                    {/* Payout */}
                    <div className="glass-panel p-3 flex justify-between items-end">
                      <div>
                        <span className="text-[10px] text-emerald-400 block uppercase font-bold tracking-wider">Your payout</span>
                        <span className="text-2xl font-extrabold text-white leading-none">N${(pendingRide.fare * 0.8).toFixed(2)}</span>
                        <span className="text-[10px] text-text-muted block mt-1">80% of N${pendingRide.fare.toFixed(2)} offer</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-text-muted block uppercase font-bold">Distance</span>
                        <span className="text-sm font-bold text-white">{pendingRide.distance} km</span>
                      </div>
                    </div>

                    {/* Route */}
                    <div className="glass-panel p-3">
                      <div className="flex gap-3">
                        <div className="flex flex-col items-center py-1 shrink-0" aria-hidden="true">
                          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-cyan-400/20"></span>
                          <span className="flex-1 min-h-[22px] border-l border-dashed border-white/25 my-1"></span>
                          <span className="w-2.5 h-2.5 rounded-[3px] bg-pink-500 ring-4 ring-pink-500/20"></span>
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-3 text-left">
                          <div className="min-w-0">
                            <span className="text-[10px] text-text-muted uppercase font-bold block">Pickup</span>
                            <span className="text-xs text-white font-semibold block truncate">{pendingRide.pickupName}</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-text-muted uppercase font-bold block">Dropoff</span>
                            <span className="text-xs text-white font-semibold block truncate">{pendingRide.dropoffName}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 w-full shrink-0">
                    <button
                      onClick={() => cancelRide(pendingRide.id)}
                      className="btn-secondary py-3 text-xs text-danger border-danger/20 justify-center"
                    >
                      Decline
                    </button>
                    <button
                      onClick={handleAccept}
                      className="btn-primary py-3 text-xs text-black bg-emerald-400 justify-center"
                    >
                      ACCEPT TRIP
                    </button>
                  </div>
                </div>
              )}

              {/* ACTIVE TRIP CHECKPOINTS */}
              {activeRide && (
                <div className="flex-1 flex flex-col min-h-0 gap-3">
                  {/* Live Navigation Map inside Driver viewport */}
                  <div className="relative w-full rounded-2xl overflow-hidden border border-white/5 shrink-0" style={{ height: '170px' }}>
                    <MapView height="100%" width="100%" showLocations={false} zoomControl={false} fitRideId={activeRide.id} />
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                    {/* Phase stepper: pickup -> arrived -> on trip */}
                    {(() => {
                      const phase = activeRide.status === 'ACCEPTED' ? 0 : activeRide.status === 'ARRIVED' ? 1 : 2;
                      const steps = ['To pickup', 'Arrived', 'On trip'];
                      return (
                        <div className="flex items-center gap-1.5" aria-label={`Trip step ${phase + 1} of 3`}>
                          {steps.map((label, i) => (
                            <div key={label} className="flex-1 min-w-0">
                              <div className={`h-1.5 rounded-full transition-all ${i <= phase ? 'bg-emerald-400' : 'bg-white/10'}`}></div>
                              <span className={`text-[10px] mt-1 block truncate ${i === phase ? 'text-emerald-400 font-bold' : 'text-text-muted'}`}>{label}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Navigation status directions */}
                    <div className="glass-panel p-3 border-l-4 border-l-emerald-400">
                      <span className="text-[10px] uppercase tracking-wide text-text-muted font-bold block">
                        {activeRide.status === 'ACCEPTED' ? 'Drive to passenger' :
                         activeRide.status === 'ARRIVED' ? 'Waiting for passenger to board' : 'Drive to dropoff'}
                      </span>

                      <p className="text-sm font-bold text-white mt-1 truncate">
                        {activeRide.status === 'ACCEPTED' ? activeRide.pickupName : activeRide.dropoffName}
                      </p>

                      <div className="flex justify-between items-center text-[11px] mt-2.5 pt-2 border-t border-white/5">
                        <div className="flex items-center gap-1.5">
                          <Navigation size={12} className="text-emerald-400 animate-pulse" />
                          <span className="text-white font-semibold">{getDistanceLeft()} km left</span>
                        </div>
                        <span className="text-text-muted font-mono">{activeRide.tier}</span>
                      </div>
                    </div>
                  </div>

                  {/* Context Action Button based on Trip phase, pinned to the bottom */}
                  <div className="shrink-0 flex flex-col gap-2">
                    {activeRide.status === 'ACCEPTED' && (
                      <button
                        onClick={() => markArrived(activeRide.id)}
                        className="btn-primary w-full py-3 bg-amber-400 hover:bg-amber-500 hover:box-shadow-amber text-black justify-center font-bold text-xs"
                      >
                        MARK ARRIVED
                      </button>
                    )}

                    {activeRide.status === 'ARRIVED' && (
                      <button
                        onClick={() => startTrip(activeRide.id)}
                        className="btn-primary w-full py-3 bg-emerald-400 text-black justify-center font-bold text-xs"
                      >
                        START TRIP · PASSENGER BOARDED
                      </button>
                    )}

                    {activeRide.status === 'IN_PROGRESS' && (
                      <button
                        onClick={() => completeTrip(activeRide.id, 5)}
                        className="btn-primary w-full py-3 bg-cyan-400 text-black justify-center font-bold text-xs"
                      >
                        COMPLETE TRIP · COLLECT FARE
                      </button>
                    )}
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
