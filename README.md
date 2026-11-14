# Planer Kolędy

Przeglądarkowa aplikacja do planowania odwiedzin duszpasterskich na terenie parafii oraz wyznaczania optymalnych tras dla 1–4 księży z wykorzystaniem Map Google i danych adresowych OpenStreetMap.

## Funkcje

- **Wybór parafii i zapamiętywanie (Firebase)** – wyszukiwanie przez Google Places API (New). Zalogowani przez Google użytkownicy mają automatycznie zapamiętane wszystkie dodane parafie, granice terenu, ustawienia i domy w bazie **Firebase Firestore**.
- **Intuicyjne wyznaczanie terenu parafii** – szybki obrys (300 m, 500 m, 1 km) jednym kliknięciem, przyciski powiększania/zmniejszania lub ręczne rysowanie wielokąta z przeciągalnymi uchwytami wierzchołków (w pełni obsługiwane także na telefonach).
- **Kliknij ulicę na mapie (OpenStreetMap)** – dotknięcie dowolnej ulicy na mapie automatycznie rozpoznaje jej nazwę, pobiera wszystkie domy z numerami i dodaje je do wybranej parafii (bez duplikatów). Dostępna jest również lista wszystkich ulic z narysowanego obrysu parafii z wyborem parzystości numerów.
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

## Wdrożenie na GitHub Pages

Repozytorium zawiera gotowy workflow `.github/workflows/deploy.yml`. Aby uruchomić działającą wersję pod adresem `https://balucharek-web.github.io/Plankoledy/`:

1. W ustawieniach repozytorium na GitHubie (**Settings -> Pages -> Build and deployment -> Source**) wybierz **GitHub Actions** (w przypadku darmowego konta GitHub repozytorium musi być publiczne).
2. W **Settings -> Secrets and variables -> Actions** dodaj sekret `VITE_GOOGLE_MAPS_API_KEY` ze swoim kluczem Google Maps API.
3. W konsoli Firebase (**Authentication -> Settings -> Authorized domains**) dodaj domenę `balucharek-web.github.io`, aby działało logowanie Google.
