import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ArchitectureGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export const ArchitectureGuideModal: React.FC<ArchitectureGuideModalProps> = ({
  open,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      className="fixed inset-0 z-[1200] bg-slate-950/50 flex items-end sm:items-center justify-center p-2 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2
            id="guide-title"
            className="text-sm sm:text-base font-semibold text-slate-900"
          >
            Jak działa Planer Kolędy
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed">
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">
              Planowanie kolędy w 4 prostych krokach
            </h3>
            <ol className="space-y-2 text-xs text-slate-600 list-decimal pl-4">
              <li>
                <strong className="text-slate-900">
                  Zaloguj się i ustaw parafię
                </strong>{' '}
                — wyszukaj swój kościół lub plebanię w zakładce{' '}
                <em>1. Parafia</em>. Po zalogowaniu przez Google każda parafia,
                jej granice oraz domy zapisują się automatycznie wyłącznie na
                Twoim koncie.
              </li>
              <li>
                <strong className="text-slate-900">
                  Wyznacz teren parafii (opcjonalnie)
                </strong>{' '}
                — wybierz gotowy obrys (300 m, 500 m, 1 km) albo narysuj własny
                wielokąt na mapie i dopasuj go przesuwając białe punkty.
              </li>
              <li>
                <strong className="text-slate-900">
                  Kliknij ulicę na mapie, aby pobrać wszystkie domy
                </strong>{' '}
                — w zakładce <em>2. Domy</em> (lub na pasku u dołu mapy) wybierz{' '}
                <strong>Kliknij ulicę</strong> i dotknij dowolną ulicę. Aplikacja
                rozpozna ulicę, pobierze wszystkie domy z numerami i doda je
                automatycznie do planu parafii.
              </li>
              <li>
                <strong className="text-slate-900">
                  Wyznacz optymalne trasy i nawiguj
                </strong>{' '}
                — kliknij <strong>Wyznacz optymalne trasy</strong>. Algorytm
                podzieli domy między 1–4 księży (bez limitu punktów na jednego
                księdza), ułoży najkrótszą kolejność odwiedzin, wyliczy godziny
                wizyt (w tym z podziałem na mieszkania w blokach) i wygeneruje
                gotowe linki do nawigacji oraz wydruk harmonogramu.
              </li>
            </ol>
          </div>

          <div className="space-y-2.5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Wykorzystane technologie i obsługa bloków
            </h3>
            <ul className="space-y-2 text-xs text-slate-600 list-disc pl-4">
              <li>
                <strong className="text-slate-900">
                  Bezpłatne mapy OpenStreetMap + GUGiK + OSRM
                </strong>{' '}
                — wyszukiwanie adresów i kościołów w całej Polsce, pobieranie
                numerów budynków oraz wyznaczanie tras bez limitu punktów na
                jednego księdza (automatyczne dzielenie długich tras na odcinki).
              </li>
              <li>
                <strong className="text-slate-900">
                  Bloki i budynki wielorodzinne
                </strong>{' '}
                — cały blok zajmuje 1 punkt na mapie, a po kliknięciu w budynek
                lub przycisk „Lokale” możesz wygenerować klatki i numery mieszkań,
                dopisać nazwiska rodzin oraz oznaczać statusy wizyt.
              </li>
              <li>
                <strong className="text-slate-900">
                  Firebase Auth + Firestore
                </strong>{' '}
                — prywatne zapamiętywanie parafii, domów i rozpisanych lokali
                w chmurze wyłącznie dla zalogowanego właściciela konta Google.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
