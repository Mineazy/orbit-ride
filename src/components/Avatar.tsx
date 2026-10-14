import { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  /** Used for the alt text and to derive initials/colour when the image is missing or fails to load. */
  name?: string;
  className?: string;
}

// Dark enough for white initials in both light and dark themes
const PALETTE = [
  ['#0ea5e9', '#6366f1'],
  ['#10b981', '#0d9488'],
  ['#f59e0b', '#ea580c'],
  ['#ec4899', '#a855f7'],
  ['#6366f1', '#8b5cf6'],
  ['#14b8a6', '#0ea5e9'],
];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const initialsOf = (name: string): string => {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
};

/**
 * Profile photo that never renders as a blank circle: if the image is missing or fails to load
 * (offline, 404, hot-link limits) it falls back to coloured initials, or a silhouette without a name.
 * Size and shape come from `className` (e.g. "w-8 h-8 rounded-full"); the fallback scales with it.
 */
export default function Avatar({ src, name = '', className = '' }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [from, to] = PALETTE[hash(name) % PALETTE.length];
  const gradient = `linear-gradient(135deg, ${from}, ${to})`;

  if (src && failedSrc !== src) {
    return (
      <img
        loading="lazy"
        decoding="async"
        src={src}
        alt={name}
        className={`object-cover ${className}`}
        // the gradient shows while the photo loads (or hangs), so there is never an empty circle
        style={{ background: gradient }}
        onError={() => setFailedSrc(src)}
      />
    );
  }

  const initials = initialsOf(name);
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={name || 'Profile photo'}
      className={`shrink-0 ${className}`}
      style={{ background: gradient }}
    >
      {initials ? (
        <text x="20" y="20" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="16" fontWeight="700" fontFamily="inherit">
          {initials}
        </text>
      ) : (
        <g fill="#fff" fillOpacity="0.9">
          <circle cx="20" cy="15" r="6.5" />
          <path d="M7 36c0-7.2 5.8-12 13-12s13 4.8 13 12z" />
        </g>
      )}
    </svg>
  );
}
