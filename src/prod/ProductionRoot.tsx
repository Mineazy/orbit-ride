import React, { Suspense, lazy, useEffect } from 'react';
import { AuthProvider } from './AuthContext';
import { AuthGate } from './SignIn';
import { Spinner } from './ui';
import ErrorBoundary from './ErrorBoundary';
import Legal from './Legal';
import { isLegalPage } from './legalConfig';
import { installErrorReporting } from './report';

const PassengerHome = lazy(() => import('./PassengerHome'));
const DriverHome = lazy(() => import('./DriverHome'));
const AdminHome = lazy(() => import('./AdminHome'));

type AppKind = 'passenger' | 'driver' | 'admin';

// Native builds and the Render site fix the app with VITE_APP_ROLE; in development ?app= picks one.
function resolveApp(): AppKind | null {
  const fromEnv = import.meta.env.VITE_APP_ROLE;
  if (fromEnv === 'passenger' || fromEnv === 'driver') return fromEnv;
  if (fromEnv === 'command-center') return 'admin';
  const fromUrl = new URLSearchParams(window.location.search).get('app');
  return fromUrl === 'passenger' || fromUrl === 'driver' || fromUrl === 'admin' ? fromUrl : null;
}

function Chooser() {
  const options: { app: AppKind; title: string; text: string }[] = [
    { app: 'passenger', title: 'Passenger', text: 'Request and track rides' },
    { app: 'driver', title: 'Driver', text: 'Register, go online and take rides' },
    { app: 'admin', title: 'Admin', text: 'Approve drivers and watch rides' },
  ];
  return (
    <div className="min-h-screen bg-bg-deep text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <h1 className="text-xl font-extrabold text-center mb-2">OrbitRide</h1>
        {options.map(o => (
          <a key={o.app} href={`?app=${o.app}`} className="glass-panel p-4 hover:border-cyan-500/40 transition-all block">
            <span className="text-sm font-bold block">{o.title}</span>
            <span className="text-xs text-text-muted">{o.text}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ProductionRoot() {
  const app = resolveApp();

  // follow the theme the demo uses
  useEffect(() => {
    try {
      document.body.classList.toggle('dark-theme', localStorage.getItem('orbitride_theme') === 'dark');
    } catch {
      /* ignore */
    }
  }, []);

  // report errors nothing else catches
  useEffect(() => installErrorReporting(app ?? 'unknown'), [app]);

  const page = new URLSearchParams(window.location.search).get('page');
  if (isLegalPage(page)) return <Legal page={page} />;
  if (!app) return <Chooser />;

  return (
    <ErrorBoundary app={app}>
    <AuthProvider>
      <Suspense fallback={<div className="min-h-screen bg-bg-deep flex flex-col"><Spinner /></div>}>
        {app === 'passenger' && <AuthGate role="passenger" title="Passenger"><PassengerHome /></AuthGate>}
        {app === 'driver' && <AuthGate role="driver" title="Driver"><DriverHome /></AuthGate>}
        {app === 'admin' && <AuthGate role="admin" title="Admin"><AdminHome /></AuthGate>}
      </Suspense>
    </AuthProvider>
    </ErrorBoundary>
  );
}
