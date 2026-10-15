import React from 'react';
import { MapPin } from 'lucide-react';
import { legalHref } from './legalConfig';

/**
 * Prominent disclosure shown BEFORE the system location permission prompt. Google Play requires this wording for
 * apps that collect location in the background: what, why, and that it happens when the app is closed or not in use.
 */
export default function LocationDisclosure({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[3000] bg-black/70 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="loc-title">
      <div className="glass-panel w-full max-w-sm p-5 flex flex-col gap-3">
        <span className="w-10 h-10 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
          <MapPin size={20} className="text-cyan-400" />
        </span>
        <h2 id="loc-title" className="text-base font-bold">Share your location while you are online</h2>
        <p className="text-xs text-white/80 leading-relaxed">
          OrbitRide collects your phone's location <b>even when the app is closed or not in use</b>, from the moment you go
          online until you go offline. We use it to show passengers where you are, to send you ride requests near you,
          and to price and record your trips.
        </p>
        <p className="text-xs text-text-muted leading-relaxed">
          A notification stays on your phone while this is on. You can go offline at any time to stop it. We never sell
          your location. <a className="underline" href={legalHref('privacy')} target="_blank" rel="noreferrer">Privacy Policy</a>
        </p>
        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1 py-2.5 text-xs justify-center" onClick={onCancel}>Not now</button>
          <button className="btn-primary flex-1 py-2.5 text-xs justify-center" onClick={onAccept}>Agree and continue</button>
        </div>
      </div>
    </div>
  );
}
