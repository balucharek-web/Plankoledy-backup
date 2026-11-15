import React, { useState } from 'react';
import { Check, Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  tone?: 'dark' | 'light';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  tone = 'light',
}) => {
  const { canInstall, isInstalled, isIosSafari, promptInstall } =
    usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);

  if (isInstalled) {
    return (
      <div
        className={`px-3 py-1.5 rounded-xl text-[11px] font-medium inline-flex items-center gap-1.5 ${
          tone === 'dark'
            ? 'text-emerald-300 bg-emerald-950/50 border border-emerald-800/50'
            : 'text-emerald-800 bg-emerald-50 border border-emerald-200'
        }`}
      >
        <Check className="w-3.5 h-3.5 shrink-0" />
        <span>Zainstalowano na urządzeniu</span>
      </div>
    );
  }

  if (!canInstall && !isIosSafari) return null;

  if (isIosSafari) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowIosGuide((v) => !v)}
          className={`w-full min-h-[38px] px-3 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors ${
            tone === 'dark'
              ? 'bg-amber-700/20 text-amber-200 border border-amber-600/30 hover:bg-amber-700/30'
              : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Zainstaluj na iPhone / iPad</span>
        </button>

        {showIosGuide && (
          <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-700 space-y-1 shadow-sm">
            <div className="flex items-center justify-between gap-2 font-semibold text-slate-900">
              <span>Instalacja w Safari (iOS):</span>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                aria-label="Zamknij podpowiedź"
                className="p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="leading-snug">
              Dotknij <Share className="w-3 h-3 inline text-amber-700 mx-0.5" />{' '}
              <strong>Udostępnij</strong> w pasku przeglądarki, a następnie wybierz{' '}
              <strong>Dodaj do ekranu początkowego</strong>.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      className={`w-full min-h-[38px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
        tone === 'dark'
          ? 'bg-amber-700 text-white hover:bg-amber-600'
          : 'bg-slate-900 text-white hover:bg-slate-800'
      }`}
    >
      <Download className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">Zainstaluj jako aplikację</span>
    </button>
  );
};
