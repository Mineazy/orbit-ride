import React, { useState } from 'react';
import { api } from './api';
import { useAuth } from './AuthContext';
import { errorMessage } from './errors';
import { legalHref } from './legalConfig';
import { ErrorNote } from './ui';

/** Links to the legal pages and account deletion (required by the App Store and Google Play) */
export default function AccountActions() {
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      await signOut();
    } catch (err) {
      setError(errorMessage(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="flex flex-col gap-3 pt-2 pb-6 text-[11px] text-text-muted">
      <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
        <a href={legalHref('terms')} target="_blank" rel="noreferrer" className="hover:text-white underline">Terms</a>
        <a href={legalHref('privacy')} target="_blank" rel="noreferrer" className="hover:text-white underline">Privacy</a>
        <a href={legalHref('refunds')} target="_blank" rel="noreferrer" className="hover:text-white underline">Refunds</a>
      </nav>
      <ErrorNote message={error} />
      {confirming ? (
        <div className="glass-panel p-3 flex flex-col gap-2">
          <p className="text-xs text-white">Delete your account? Your name and number are erased and you cannot sign back in to this account. This cannot be undone.</p>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 py-2 text-xs justify-center" onClick={() => setConfirming(false)} disabled={busy}>Keep my account</button>
            <button className="flex-1 py-2 text-xs font-bold rounded-xl bg-danger/20 text-danger border border-danger/30" onClick={() => void remove()} disabled={busy}>
              {busy ? 'Deleting...' : 'Yes, delete it'}
            </button>
          </div>
        </div>
      ) : (
        <button className="text-left underline hover:text-white w-fit" onClick={() => setConfirming(true)}>Delete my account</button>
      )}
    </footer>
  );
}
