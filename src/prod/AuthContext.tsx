import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getBackend, isBackendConfigured } from './backend';
import { errorMessage, normalizePhone } from './errors';
import { releaseDevice } from './push';
import type { DriverProfile, Profile, UserRole } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  configured: boolean;
  userId: string | null;
  profile: Profile | null;
  driver: DriverProfile | null;
  /** Ask for a text message code. Returns an error message, or null on success. */
  sendCode: (phone: string, role: Exclude<UserRole, 'admin'>) => Promise<string | null>;
  /** Check the code. Returns an error message, or null on success. */
  verifyCode: (phone: string, code: string) => Promise<string | null>;
  saveName: (name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Reload the profile and driver rows (after registering a vehicle, an approval, and so on). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isBackendConfigured();
  const [status, setStatus] = useState<Status>(configured ? 'loading' : 'signedOut');
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [driver, setDriver] = useState<DriverProfile | null>(null);

  const loadAccount = useCallback(async (uid: string) => {
    const client = await getBackend();
    const [{ data: p }, { data: d }] = await Promise.all([
      client.from('profiles').select('*').eq('id', uid).maybeSingle(),
      client.from('driver_profiles').select('*').eq('id', uid).maybeSingle(),
    ]);
    setProfile((p as Profile | null) ?? null);
    setDriver((d as DriverProfile | null) ?? null);
  }, []);

  useEffect(() => {
    if (!configured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const client = await getBackend();
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      const uid = data.session?.user.id ?? null;
      if (uid) await loadAccount(uid);
      if (cancelled) return;
      setUserId(uid);
      setStatus(uid ? 'signedIn' : 'signedOut');

      const { data: sub } = client.auth.onAuthStateChange(async (_event, session) => {
        const next = session?.user.id ?? null;
        if (next) await loadAccount(next);
        else {
          setProfile(null);
          setDriver(null);
        }
        setUserId(next);
        setStatus(next ? 'signedIn' : 'signedOut');
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })().catch(() => {
      if (!cancelled) setStatus('signedOut');
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [configured, loadAccount]);

  const value = useMemo<AuthValue>(() => ({
    status,
    configured,
    userId,
    profile,
    driver,

    async sendCode(phone, role) {
      const normalized = normalizePhone(phone);
      if (!normalized) return 'Enter a valid mobile number, for example 081 234 5678.';
      const client = await getBackend();
      const { error } = await client.auth.signInWithOtp({ phone: normalized, options: { data: { role } } });
      return error ? errorMessage(error) : null;
    },

    async verifyCode(phone, code) {
      const normalized = normalizePhone(phone);
      if (!normalized) return 'Enter a valid mobile number.';
      const client = await getBackend();
      const { error } = await client.auth.verifyOtp({ phone: normalized, token: code.trim(), type: 'sms' });
      return error ? errorMessage(error) : null;
    },

    async saveName(name) {
      const trimmed = name.trim();
      if (trimmed.length < 2) return 'Enter your name (at least 2 characters).';
      if (!userId) return 'You are signed out.';
      const client = await getBackend();
      const { error } = await client.from('profiles').update({ full_name: trimmed }).eq('id', userId);
      if (error) return errorMessage(error);
      await loadAccount(userId);
      return null;
    },

    async signOut() {
      await releaseDevice(); // this phone stops receiving the signed-out person's notifications
      const client = await getBackend();
      await client.auth.signOut();
    },

    async refresh() {
      if (userId) await loadAccount(userId);
    },
  }), [status, configured, userId, profile, driver, loadAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
