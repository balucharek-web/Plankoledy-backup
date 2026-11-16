import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print bg-slate-900 text-amber-100 border-b border-amber-600/40 px-3 sm:px-5 py-2 flex items-center gap-2.5 text-xs shrink-0"
    >
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="leading-snug">
        <strong className="text-white">Praca w trybie offline</strong> — zapisane
        trasy i lokale w blokach są dostępne lokalnie; zmiany zsynchronizują się
        automatycznie po odzyskaniu zasięgu.
      </span>
    </div>
  );
};
