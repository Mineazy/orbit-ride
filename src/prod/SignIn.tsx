import React, { useEffect, useState } from 'react';
import { Navigation } from 'lucide-react';
import { useAuth } from './AuthContext';
import { BACKEND_KIND } from './backend';
import { ErrorNote, InfoNote, Spinner } from './ui';
import type { UserRole } from './types';
import { legalHref } from './legalConfig';

// Local test backend details, shown only when VITE_BACKEND=local
const LOCAL_HINT = (
  <InfoNote>
    Local test backend: the text message code is always <b>123456</b>. To try the admin screen, sign in as{' '}
    <b>081 000 0000</b>.
  </InfoNote>
);

function Brand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center">
      <span className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(0,242,254,0.3)]">
        <Navigation size={26} className="fill-black text-black" />
      </span>
      <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
      <p className="text-xs text-text-muted mt-1">{subtitle}</p>
    </div>
  );
}

const fieldClass =
  'w-full bg-black/30 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/60 transition-colors';

function SignInScreen({ role, title }: { role: Exclude<UserRole, 'admin'> | 'admin'; title: string }) {
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const err = await sendCode(phone, role === 'admin' ? 'passenger' : role);
    setBusy(false);
    if (err) return setError(err);
    setStep('code');
    setCooldown(30);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await verifyCode(phone, code);
    setBusy(false);
    if (err) setError(err); // on success the session changes and the gate swaps this screen out
  };

  return (
    <div className="min-h-screen bg-bg-deep text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-5">
        <Brand title={`OrbitRide ${title}`} subtitle={step === 'phone' ? 'Sign in with your mobile number' : `Enter the code we sent to ${phone}`} />

        {step === 'phone' ? (
          <form onSubmit={request} className="flex flex-col gap-3">
            <label htmlFor="phone" className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Mobile number</label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder="081 234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
            />
            <p className="text-[11px] text-text-muted">We will text you a 6-digit code. Standard message rates may apply.</p>
            <p className="text-[11px] text-text-muted">
              By continuing you agree to our{' '}
              <a className="underline" href={legalHref('terms')} target="_blank" rel="noreferrer">Terms</a> and{' '}
              <a className="underline" href={legalHref('privacy')} target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
            <ErrorNote message={error} />
            <button className="btn-primary w-full py-3 justify-center text-sm" disabled={busy || phone.trim().length < 5}>
              {busy ? 'Sending...' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <label htmlFor="code" className="text-[11px] text-text-muted uppercase font-bold tracking-wider">6-digit code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${fieldClass} text-center tracking-[0.4em] font-mono text-lg`}
            />
            <ErrorNote message={error} />
            <button className="btn-primary w-full py-3 justify-center text-sm" disabled={busy || code.length < 6}>
              {busy ? 'Checking...' : 'Verify and continue'}
            </button>
            <div className="flex justify-between text-[11px]">
              <button type="button" className="text-text-muted hover:text-white" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>
                Change number
              </button>
              <button type="button" className="text-cyan-400 disabled:text-text-muted" disabled={cooldown > 0 || busy} onClick={() => void request()}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {BACKEND_KIND === 'local' && LOCAL_HINT}
      </div>
    </div>
  );
}

function NameStep() {
  const { saveName, signOut } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await saveName(name);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen bg-bg-deep text-white flex flex-col items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <Brand title="Welcome to OrbitRide" subtitle="What should we call you?" />
        <label htmlFor="name" className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Your name</label>
        <input id="name" type="text" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Samuel Negumbo" className={fieldClass} />
        <p className="text-[11px] text-text-muted">Drivers and passengers see this name during a ride.</p>
        <ErrorNote message={error} />
        <button className="btn-primary w-full py-3 justify-center text-sm" disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving...' : 'Continue'}
        </button>
        <button type="button" className="text-[11px] text-text-muted hover:text-white" onClick={() => void signOut()}>
          Use a different number
        </button>
      </form>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen bg-bg-deep text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-4 text-center">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="text-sm text-text-muted leading-relaxed">{children}</div>
        <button className="btn-secondary w-full py-2.5 text-xs justify-center" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}

/**
 * Decides what to show before the app itself: setup problem, loading, sign-in, wrong account type,
 * or the one-time name prompt. Children render only for a signed-in account of the right role.
 */
export function AuthGate({ role, title, children }: { role: UserRole; title: string; children: React.ReactNode }) {
  const { status, configured, profile } = useAuth();

  if (!configured) {
    return (
      <Notice title="Backend not configured">
        Set <code className="font-mono text-cyan-400">VITE_SUPABASE_URL</code> and{' '}
        <code className="font-mono text-cyan-400">VITE_SUPABASE_ANON_KEY</code> (or run with{' '}
        <code className="font-mono text-cyan-400">VITE_BACKEND=local</code> for a local test backend).
      </Notice>
    );
  }
  if (status === 'loading') return <div className="min-h-screen bg-bg-deep flex flex-col"><Spinner /></div>;
  if (status === 'signedOut') return <SignInScreen role={role} title={title} />;
  if (!profile) return <div className="min-h-screen bg-bg-deep flex flex-col"><Spinner label="Loading your account..." /></div>;

  if (profile.role !== role) {
    const names: Record<UserRole, string> = { passenger: 'Passenger', driver: 'Driver', admin: 'Admin' };
    return (
      <Notice title={`This is a ${names[profile.role]} account`}>
        This number is registered as a {names[profile.role].toLowerCase()} account, so it cannot be used in the {names[role].toLowerCase()} app.
        Sign out and use a different number, or open the {names[profile.role].toLowerCase()} app.
      </Notice>
    );
  }
  if (role !== 'admin' && !profile.full_name.trim()) return <NameStep />;
  return <>{children}</>;
}
