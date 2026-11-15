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
      className="no-print fixed bottom-20 lg:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-[950] flex items-center gap-2.5 bg-slate-900 text-amber-100 border border-amber-600/40 px-3.5 py-2.5 rounded-xl shadow-lg text-xs"
    >
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="leading-snug">
        <strong className="text-white">Tryb offline</strong> — zapisane trasy i
        lokale w blokach pozostają dostępne; zmiany zsynchronizują się po
        odzyskaniu zasięgu.
      </span>
    </div>
  );
};
