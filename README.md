# Planer Kolędy

Przeglądarkowa aplikacja do planowania odwiedzin duszpasterskich na terenie parafii oraz wyznaczania optymalnych tras dla 1–4 księży z wykorzystaniem Map Google i danych adresowych OpenStreetMap.

## Funkcje

- **Wybór parafii i kościoła** – wyszukiwanie przez Google Places API (New) z automatycznym centrowaniem mapy.
- **Intuicyjne wyznaczanie terenu parafii** – szybki obrys (500 m wokół kościoła) jednym kliknięciem lub ręczne rysowanie wielokąta z przeciągalnymi uchwytami wierzchołków.
- **Automatyczne pobieranie ulic i domów (OpenStreetMap)** – pobieranie ulic z wyznaczonego obszaru (lub promienia wokół parafii), wybór parzystości numerów (wszystkie / parzyste / nieparzyste), naturalne sortowanie polskich numerów domów i zapis w formie pełnego adresu domu.
- **Dodawanie pojedynczych domów** – wyszukiwarka adresów lub kliknięcie bezpośrednio na budynek na mapie (automatyczne rozpoznanie adresu przez Overpass / Nominatim).
- **Podział na 1–4 księży i optymalizacja tras** – geometryczny podział na sektory kątowe oraz wyznaczanie kolejności odwiedzin przez Google Maps Routes API (`computeRoutes` z `optimizeWaypointOrder`).
- **Harmonogram, nawigacja i eksport** – obliczanie godzin przyjścia i wyjścia, linki do nawigacji w Google Maps, widok do druku oraz eksport do pliku CSV (UTF-8 z separatorem `;` dla Excela).

## Wymagania

- Node.js 20+
- Klucz **Google Maps Platform** z włączonymi usługami:
  - **Maps JavaScript API**
  - **Places API (New)**
  - **Routes API**

## Uruchomienie lokalne

1. Zainstaluj zależności:

   ```bash
   npm install
   ```

2. Skopiuj plik `.env.example` do `.env` i uzupełnij swój klucz Google Maps API:

   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_GOOGLE_MAPS_API_KEY="TWOJ_KLUCZ_GOOGLE_MAPS_API"
   ```

3. Uruchom serwer deweloperski:

   ```bash
   npm run dev
   ```

   Aplikacja będzie dostępna pod adresem `http://localhost:3000`.

## Budowanie produkcyjne i weryfikacja

```bash
npm run lint
npm run build
```

Gotowe pliki statyczne zostaną zapisane w katalogu `dist/`, który można wdrożyć na dowolny hosting statyczny (np. Vercel, Netlify, Cloudflare Pages) – pamiętając o ustawieniu zmiennej środowiskowej `VITE_GOOGLE_MAPS_API_KEY` w panelu hostingu.
