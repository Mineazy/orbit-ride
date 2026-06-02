import React, { useState } from 'react';
import { SimulationProvider } from './context/SimulationContext';
import CommandCenter from './components/CommandCenter';
import ClientApp from './components/ClientApp';
import DriverApp from './components/DriverApp';
import { LayoutGrid, Monitor, Smartphone, Navigation } from 'lucide-react';

function AppContent() {
  const [layoutMode, setLayoutMode] = useState('matrix'); // matrix | center | client | driver

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Top Navbar Header */}
      <header className="glass-panel rounded-none border-t-0 border-x-0 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 bg-[rgba(10,10,18,0.7)] sticky top-0 z-[1000]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center text-black font-extrabold text-sm shadow-[0_0_15px_rgba(0,242,254,0.3)]">
            <Navigation size={16} className="fill-black" />
          </div>
          <div>
            <span className="font-extrabold tracking-tight text-white text-md font-display" style={{ fontFamily: 'var(--font-display)' }}>
              Orbit<span className="text-cyan-400">Ride</span>
            </span>
            <span className="text-[9px] block text-text-muted font-mono leading-none">V2.4 Dispatch Network</span>
          </div>
        </div>

        {/* Layout View Modes */}
        <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/5">
          <button 
            onClick={() => setLayoutMode('matrix')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'matrix' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
            }`}
          >
            <LayoutGrid size={13} />
            <span className="hidden sm:inline">Simulation Matrix</span>
          </button>
          
          <button 
            onClick={() => setLayoutMode('center')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'center' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
            }`}
          >
            <Monitor size={13} />
            <span className="hidden sm:inline">Command Center</span>
          </button>

          <button 
            onClick={() => setLayoutMode('client')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'client' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
            }`}
          >
            <Smartphone size={13} className="text-cyan-400" />
            <span className="hidden sm:inline">Passenger App</span>
          </button>

          <button 
            onClick={() => setLayoutMode('driver')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'driver' ? 'bg-cyan-500 text-black' : 'text-text-muted hover:text-white'
            }`}
          >
            <Smartphone size={13} className="text-emerald-400" />
            <span className="hidden sm:inline">Driver App</span>
          </button>
        </div>
      </header>

      {/* Main Body viewport */}
      <main className="flex-1 p-4 md:p-6 flex flex-col justify-start items-stretch">
        
        {/* View mode matrices */}
        {layoutMode === 'matrix' && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 w-full flex-1 max-w-7xl mx-auto">
            {/* Command Center Panel: Column 1 & 2 */}
            <div className="xl:col-span-2 flex flex-col">
              <CommandCenter />
            </div>

            {/* Client Mobile Frame Mock: Column 3 */}
            <div className="flex flex-col items-center justify-center">
              <div className="text-center mb-2">
                <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Client Terminal</span>
                <p className="text-[9px] text-text-muted">Simulates passenger request & rating</p>
              </div>
              <ClientApp />
            </div>

            {/* Driver Mobile Frame Mock: Column 4 */}
            <div className="flex flex-col items-center justify-center">
              <div className="text-center mb-2">
                <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Driver Console</span>
                <p className="text-[9px] text-text-muted">Simulates bids & navigation actions</p>
              </div>
              <DriverApp />
            </div>
          </div>
        )}

        {layoutMode === 'center' && (
          <div className="w-full flex-1 max-w-6xl mx-auto">
            <CommandCenter />
          </div>
        )}

        {layoutMode === 'client' && (
          <div className="flex-1 flex flex-col items-center justify-center py-6">
            <div className="text-center mb-3">
              <h2 className="text-md font-bold text-white uppercase tracking-wider">Passenger Device Mockup</h2>
              <p className="text-xs text-text-muted">Interactive booking screen simulation</p>
            </div>
            <ClientApp />
          </div>
        )}

        {layoutMode === 'driver' && (
          <div className="flex-1 flex flex-col items-center justify-center py-6">
            <div className="text-center mb-3">
              <h2 className="text-md font-bold text-white uppercase tracking-wider">Driver Fleet Console</h2>
              <p className="text-xs text-text-muted">Interactive dispatch acceptance terminal</p>
            </div>
            <DriverApp />
          </div>
        )}
      </main>

      {/* Footer bar */}
      <footer className="py-6 border-t border-muted bg-black/30 text-center text-xs text-text-muted mt-8">
        <p>© 2026 OrbitRide Systems. Running under Antigravity simulation sandbox.</p>
      </footer>
    </div>
  );
}

export default function App() {
  const role = import.meta.env.VITE_APP_ROLE;

  if (role === 'passenger') {
    return (
      <SimulationProvider>
        <ClientApp />
      </SimulationProvider>
    );
  }

  if (role === 'driver') {
    return (
      <SimulationProvider>
        <DriverApp />
      </SimulationProvider>
    );
  }

  if (role === 'command-center') {
    return (
      <SimulationProvider>
        <div className="flex-1 flex flex-col min-h-screen bg-[#06060c] text-white">
          {/* Top Navbar Header */}
          <header className="glass-panel rounded-none border-t-0 border-x-0 px-6 py-4 flex items-center gap-2 bg-[rgba(10,10,18,0.7)] sticky top-0 z-[1000]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center text-black font-extrabold text-sm shadow-[0_0_15px_rgba(0,242,254,0.3)]">
              <Navigation size={16} className="fill-black" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-white text-md font-display" style={{ fontFamily: 'var(--font-display)' }}>
                Orbit<span className="text-cyan-400">Ride</span>
              </span>
              <span className="text-[9px] block text-text-muted font-mono leading-none">V2.4 Dispatcher Console</span>
            </div>
          </header>

          {/* Main Body viewport */}
          <main className="flex-1 p-4 md:p-6 flex flex-col justify-start items-stretch">
            <div className="w-full flex-1 max-w-6xl mx-auto">
              <CommandCenter />
            </div>
          </main>

          {/* Footer bar */}
          <footer className="py-6 border-t border-muted bg-black/30 text-center text-xs text-text-muted mt-8">
            <p>© 2026 OrbitRide Systems. Dispatch Panel.</p>
          </footer>
        </div>
      </SimulationProvider>
    );
  }

  return (
    <SimulationProvider>
      <AppContent />
    </SimulationProvider>
  );
}
