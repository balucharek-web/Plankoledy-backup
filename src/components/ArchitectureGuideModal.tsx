import React from 'react';
import { X } from 'lucide-react';

interface ArchitectureGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export const ArchitectureGuideModal: React.FC<ArchitectureGuideModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-end sm:items-center justify-center p-2 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 id="guide-title" className="text-sm sm:text-base font-semibold text-slate-900">
            Jak działa i jak zbudowana jest ta aplikacja
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
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              1. Stos technologiczny (Frontend + Google Maps Platform)
            </h3>
            <p className="text-xs text-slate-600">
              Aplikacja działa w pełni w przeglądarce w oparciu o React,
              TypeScript oraz oficjalną bibliotekę{' '}
              <code className="font-mono text-slate-900 bg-slate-100 px-1 py-0.5 rounded">
                @vis.gl/react-google-maps
              </code>{' '}
              bez konieczności stosowania przestarzałych usług typu
              DirectionsService czy Marker.
            </p>
          </div>

          <div className="space-y-2.5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              2. Wykorzystane usługi Google Maps Platform
            </h3>
            <ul className="space-y-2 text-xs text-slate-600 list-disc pl-4">
              <li>
                <strong className="text-slate-900">Maps JavaScript API</strong>{' '}
                — interaktywna mapa z nowoczesnymi znacznikami{' '}
                <code className="font-mono">AdvancedMarkerElement</code> i
                warstwą poligonów do wyznaczania granic parafii.
              </li>
              <li>
                <strong className="text-slate-900">Places API (New)</strong> —
                podpowiedzi adresów (
                <code className="font-mono">
                  AutocompleteSuggestion.fetchAutocompleteSuggestions
                </code>{' '}
                z tokenem sesji <code className="font-mono">AutocompleteSessionToken</code>)
                oraz masowy import ulic przez{' '}
                <code className="font-mono">Place.searchByText</code>.
              </li>
              <li>
                <strong className="text-slate-900">Routes API (SDK JS)</strong>{' '}
                — wywołanie{' '}
                <code className="font-mono">Route.computeRoutes</code> z flagą{' '}
                <code className="font-mono">optimizeWaypointOrder: true</code>,
                które rozwiązuje problem komiwojażera (TSP) i zwraca optymalną
                kolejność przystanków (
                <code className="font-mono">
                  optimizedIntermediateWaypointIndices
                </code>
                ), odcinki oraz polilinię trasy (do 25 punktów pośrednich na
                jedną trasę).
              </li>
              <li>
                <strong className="text-slate-900">Geometry Library</strong> —
                sprawdzanie funkcją{' '}
                <code className="font-mono">
                  geometry.poly.containsLocation
                </code>
                , czy wskazany dom znajduje się wewnątrz wyrysowanego terenu
                parafii.
              </li>
              <li>
                <strong className="text-slate-900">
                  OpenStreetMap (Overpass API)
                </strong>{' '}
                — automatyczne pobieranie listy nazwanych ulic i numerów domów
                (z podziałem na parzyste/nieparzyste) z narysowanego obrysu
                parafii lub promienia wokół kościoła.
              </li>
            </ul>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              3. Algorytm podziału na wielu księży
            </h3>
            <p className="text-xs text-slate-600">
              Gdy kolęduje jednocześnie od 2 do 4 księży, aplikacja sortuje
              punkty kątowo wokół kościoła parafialnego i dzieli je na spójne
              sektory geograficzne (z poszanowaniem limitu 25 punktów na trasę w
              Routes API). Następnie dla każdego księdza osobno wywołuje
              optymalizację trasy i dolicza czas trwania wizyt w domach, aby
              wygenerować gotowy harmonogram godzinowy oraz link do nawigacji w
              telefonie.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
