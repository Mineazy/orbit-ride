import React, { useState, useEffect } from 'react';
import { useSimulation, WINDHOEK_LOCATIONS } from '../context/SimulationContext';
import { 
  Shield, Activity, DollarSign, Star, Navigation, 
  Sun, CloudRain, Trash2, Cpu, Zap, Eye, Compass 
} from 'lucide-react';
import MapView from './MapView';

export default function CommandCenter() {
  const {
    drivers,
    rides,
    logs,
    metrics,
    simulationSpeed,
    setSimulationSpeed,
    surgeMultiplier,
    setSurgeMultiplier,
    weather,
    setWeather,
    autoMode,
    setAutoMode,
    toggleDriverOnline,
    addLog,
    requestRide
  } = useSimulation();

  const [activeTab, setActiveTab] = useState('map'); // map | roster | analytics
  const [revenueHistory, setRevenueHistory] = useState([50, 90, 140, 220, 310, 420, 542.80]);

  // Update mock revenue chart points when metrics change
  useEffect(() => {
    setRevenueHistory(prev => {
      const lastVal = prev[prev.length - 1];
      if (lastVal !== metrics.totalRevenue) {
        return [...prev.slice(1), metrics.totalRevenue];
      }
      return prev;
    });
  }, [metrics.totalRevenue]);

  // Handle emergency storm button
  const triggerStorm = () => {
    setWeather('rainy');
    setSurgeMultiplier(2.2);
    addLog('⚠️ DISPATCH ALERT: High Intensity Storm registered. Fares multiplied by 1.3x. Surge escalated to 2.2x!', 'warning');
  };

  // Handle clear logs
  const clearSimulationLogs = () => {
    addLog('Operations log feed cleared by Dispatcher.', 'info');
  };

  // Convert array to SVG path coords for sparkline
  const generateSparkline = (data, width = 240, height = 50) => {
    if (data.length === 0) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    return data.map((val, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 10) - 5;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  };

  return (
    <div className="w-full h-full flex flex-col gap-6" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Title & Dispatch Status */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-muted pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-ping"></div>
            <span className="text-xs uppercase tracking-widest text-cyan-400 font-bold">OrbitRide Live</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mt-1" style={{ fontFamily: 'var(--font-display)' }}>
            COMMAND CENTER
          </h1>
        </div>

        {/* Global Controls Panel */}
        <div className="flex flex-wrap items-center gap-4 bg-[rgba(255,255,255,0.03)] border border-muted p-2 rounded-xl">
          {/* Weather Toggle */}
          <div className="flex items-center bg-black/35 rounded-lg overflow-hidden border border-white/5">
            <button 
              onClick={() => setWeather('clear')}
              className={`p-2 flex items-center gap-1.5 text-xs font-semibold transition-all ${
                weather === 'clear' ? 'bg-amber-500 text-black' : 'text-text-muted hover:text-white'
              }`}
              title="Set Sunny Weather"
            >
              <Sun size={14} /> Clear
            </button>
            <button 
              onClick={() => setWeather('rainy')}
              className={`p-2 flex items-center gap-1.5 text-xs font-semibold transition-all ${
                weather === 'rainy' ? 'bg-indigo-600 text-white' : 'text-text-muted hover:text-white'
              }`}
              title="Set Storm Mode"
            >
              <CloudRain size={14} /> Storm
            </button>
          </div>

          {/* Surge Price Multiplier */}
          <div className="flex items-center gap-2 bg-black/35 px-3 py-1.5 rounded-lg border border-white/5">
            <Zap size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-text-muted">Surge:</span>
            <input 
              type="range" 
              min="1.0" 
              max="2.5" 
              step="0.1"
              value={surgeMultiplier}
              onChange={(e) => setSurgeMultiplier(parseFloat(e.target.value))}
              className="w-16 accent-amber-400 h-1.5 rounded-lg cursor-pointer"
            />
            <span className="text-xs font-bold text-amber-400 w-8">{surgeMultiplier.toFixed(1)}x</span>
          </div>

          {/* Speed Scale */}
          <div className="flex items-center gap-1.5 bg-black/35 px-2 py-1 rounded-lg border border-white/5">
            <span className="text-[10px] font-bold text-text-muted uppercase mr-1">Speed</span>
            {[1, 2, 5].map(speed => (
              <button 
                key={speed}
                onClick={() => setSimulationSpeed(speed)}
                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${
                  simulationSpeed === speed ? 'bg-cyan-500 text-black' : 'text-text-muted hover:bg-white/5'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Auto Mode Bot Toggle */}
          <button 
            onClick={() => setAutoMode(!autoMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              autoMode 
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                : 'bg-black/35 text-text-muted border-white/5 hover:text-white'
            }`}
          >
            <Cpu size={14} className={autoMode ? 'animate-spin' : ''} />
            <span>{autoMode ? 'Auto Dispatch ON' : 'Auto Dispatch OFF'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Roster Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Trips */}
        <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-cyan-400">
          <div>
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">Total Completed Trips</span>
            <p className="text-2xl font-bold mt-1 text-white">{metrics.totalTrips}</p>
          </div>
          <div className="p-3 bg-cyan-400/10 rounded-lg text-cyan-400">
            <Activity size={20} />
          </div>
        </div>

        {/* Total Earnings */}
        <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-emerald-400">
          <div>
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">Total Revenue</span>
            <p className="text-2xl font-bold mt-1 text-white">N${metrics.totalRevenue.toFixed(2)}</p>
          </div>
          <div className="p-3 bg-emerald-400/10 rounded-lg text-emerald-400">
            <DollarSign size={20} />
          </div>
        </div>

        {/* Avg Star Rating */}
        <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-amber-400">
          <div>
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">Fleet Rating</span>
            <p className="text-2xl font-bold mt-1 text-white">{metrics.avgRating} / 5.0</p>
          </div>
          <div className="p-3 bg-amber-400/10 rounded-lg text-amber-400">
            <Star size={20} className="fill-amber-400" />
          </div>
        </div>

        {/* Active Rides */}
        <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-purple-400">
          <div>
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">Active Dispatches</span>
            <p className="text-2xl font-bold mt-1 text-white">
              {rides.filter(r => r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS' || r.status === 'REQUESTED').length}
            </p>
          </div>
          <div className="p-3 bg-purple-400/10 rounded-lg text-purple-400">
            <Navigation size={20} className="animate-pulse" />
          </div>
        </div>
      </div>

      {/* Main Panel layout splits Map and Statistics */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 flex-1 min-h-[450px]">
        {/* Map Center Panel */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <div className="flex justify-between items-center bg-[rgba(255,255,255,0.02)] p-2 rounded-xl border border-muted">
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveTab('map')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'map' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                }`}
              >
                Simulation Map
              </button>
              <button 
                onClick={() => setActiveTab('roster')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'roster' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                }`}
              >
                Fleet Roster ({drivers.length})
              </button>
              <button 
                onClick={() => setActiveTab('analytics')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'analytics' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
                }`}
              >
                Analytics & Logs
              </button>
            </div>
          </div>

          {activeTab === 'map' && (
            <div className="flex-1 min-h-[380px] h-full relative">
              <MapView height="100%" width="100%" showLocations={true} />
            </div>
          )}

          {activeTab === 'roster' && (
            <div className="glass-panel p-4 flex-1 overflow-y-auto">
              <h3 className="text-md font-bold mb-3 uppercase tracking-wide text-white">Active Operator Fleet</h3>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-muted text-text-muted font-bold">
                      <th className="py-2.5">Driver</th>
                      <th className="py-2.5">Vehicle Detail</th>
                      <th className="py-2.5">Rating</th>
                      <th className="py-2.5">Total Earnings</th>
                      <th className="py-2.5">Status</th>
                      <th className="py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map(driver => (
                      <tr key={driver.id} className="border-b border-muted/50 hover:bg-white/5 transition-all">
                        <td className="py-3 flex items-center gap-3">
                          <img 
                            src={driver.avatar} 
                            alt={driver.name} 
                            className="w-8 h-8 rounded-full object-cover border border-white/10"
                          />
                          <div>
                            <p className="font-semibold text-white">{driver.name}</p>
                            <p className="text-[10px] text-text-muted">ID: {driver.id}</p>
                          </div>
                        </td>
                        <td className="py-3">
                          <p className="text-white font-medium">{driver.car}</p>
                          <span className="text-[10px] text-cyan-400 font-semibold uppercase">{driver.tier}</span>
                        </td>
                        <td className="py-3">⭐ {driver.rating.toFixed(2)}</td>
                        <td className="py-3 font-semibold text-emerald-400">N${driver.earnings.toFixed(2)}</td>
                        <td className="py-3">
                          <span className={`badge ${
                            driver.status === 'ONLINE_IDLE' ? 'badge-emerald' : 
                            driver.status === 'OFFLINE' ? 'badge-danger' : 'badge-amber'
                          }`}>
                            {driver.status === 'ONLINE_IDLE' ? 'Online' : 
                             driver.status === 'OFFLINE' ? 'Offline' : 'On Ride'}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button 
                            onClick={() => toggleDriverOnline(driver.id)}
                            className={`px-2.5 py-1 rounded font-bold text-[10px] uppercase transition-all ${
                              driver.status === 'OFFLINE' 
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30' 
                                : 'bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30'
                            }`}
                            disabled={driver.status !== 'ONLINE_IDLE' && driver.status !== 'OFFLINE'}
                          >
                            {driver.status === 'OFFLINE' ? 'Bring Online' : 'Force Offline'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
              {/* Earnings Sparkline Chart */}
              <div className="glass-panel p-4 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-white">Revenue Projection spark</h4>
                  <p className="text-xs text-text-muted">Real-time cumulative system billing values</p>
                </div>
                <div className="py-4 flex justify-center items-end h-32">
                  <svg className="w-full max-w-[280px]" viewBox="0 0 240 50">
                    <defs>
                      <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.3"/>
                        <stop offset="100%" stopColor="#00f2fe" stopOpacity="0.0"/>
                      </linearGradient>
                    </defs>
                    <path 
                      d={generateSparkline(revenueHistory, 240, 50)} 
                      fill="none" 
                      stroke="var(--primary)" 
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
                <div className="flex justify-between text-[10px] text-text-muted">
                  <span>Previous Ticks</span>
                  <span>Live: N${metrics.totalRevenue.toFixed(2)}</span>
                </div>
              </div>

              {/* Grid Hotspots */}
              <div className="glass-panel p-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-white mb-2">City Hub Hotspots</h4>
                <div className="flex flex-col gap-2 max-h-36 overflow-y-auto">
                  {WINDHOEK_LOCATIONS.slice(0, 5).map((loc, i) => (
                    <div key={loc.id} className="flex justify-between items-center text-xs p-1.5 bg-white/5 rounded border border-white/5">
                      <span className="font-semibold text-white">{loc.name}</span>
                      <span className="text-[10px] uppercase font-bold text-text-muted">{loc.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar Control logs panel */}
        <div className="flex flex-col gap-4">
          {/* Dispatch Logs */}
          <div className="glass-panel flex-1 flex flex-col overflow-hidden min-h-[300px]">
            <div className="p-4 border-b border-muted flex justify-between items-center bg-black/20">
              <div className="flex items-center gap-1.5">
                <Shield size={14} className="text-cyan-400" />
                <h3 className="text-xs uppercase tracking-wider font-bold text-white">System Feed</h3>
              </div>
              <button 
                onClick={clearSimulationLogs}
                className="text-text-muted hover:text-danger transition-all p-1"
                title="Reset log views"
              >
                <Trash2 size={12} />
              </button>
            </div>
            
            <div className="p-3 flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col gap-2 bg-black/40">
              {logs.map((log) => (
                <div 
                  key={log.id} 
                  className={`p-2 border-l-2 rounded-r bg-[rgba(255,255,255,0.01)] ${
                    log.type === 'success' ? 'border-emerald-500 text-emerald-300' :
                    log.type === 'warning' ? 'border-amber-500 text-amber-300' :
                    log.type === 'driver' ? 'border-purple-500 text-purple-300' :
                    log.type === 'passenger' ? 'border-cyan-500 text-cyan-300' :
                    'border-muted text-text-muted'
                  }`}
                >
                  <span className="opacity-50 text-[10px] block mb-0.5">{log.time}</span>
                  {log.text}
                </div>
              ))}
            </div>
          </div>

          {/* Quick Simulation controls panel */}
          <div className="glass-panel p-4 flex flex-col gap-3">
            <h3 className="text-xs uppercase tracking-wider font-bold text-white">Simulation Triggers</h3>
            
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={triggerStorm}
                className="btn-secondary py-2 justify-center font-bold text-xs text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
              >
                <CloudRain size={12} /> Storm Trigger
              </button>
              <button 
                onClick={() => {
                  const pickup = WINDHOEK_LOCATIONS[0];
                  const dropoff = WINDHOEK_LOCATIONS[5];
                  requestRide(pickup.coords, dropoff.coords, pickup.name, dropoff.name, 'OrbitX');
                }}
                className="btn-secondary py-2 justify-center font-bold text-xs text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/10"
              >
                <Zap size={12} /> Test Booking
              </button>
            </div>

            <div className="text-[10px] text-text-muted flex justify-between items-center mt-1 border-t border-muted/50 pt-2">
              <span>Dynamic Factor: <b>{weather === 'rainy' ? '1.3x (Rain)' : '1.0x (Clear)'}</b></span>
              <span>Active drivers: <b>{drivers.filter(d => d.status !== 'OFFLINE').length}</b></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
