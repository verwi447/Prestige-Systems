# Deklaracja dostępności — Prestige Systems HUB

[PLACEHOLDER: Prestige Systems] zobowiązuje się zapewniać dostępność systemu Prestige
Systems HUB zgodnie z ustawą z dnia 4 kwietnia 2019 r. o dostępności cyfrowej stron
internetowych i aplikacji mobilnych podmiotów publicznych oraz — w zakresie, w jakim
ma zastosowanie — ustawą z dnia 26 kwietnia 2024 r. o zapewnianiu spełniania wymagań
dostępności niektórych produktów i usług przez podmioty gospodarcze.

Niniejsza deklaracja dotyczy aplikacji: **Prestige Systems HUB** (panel administratora
i panel klienta), dostępnej pod adresem [PLACEHOLDER: adres domeny, np.
https://support.prestigesystems.pl].

## Status pod względem zgodności

Aplikacja jest **częściowo zgodna** ze standardem WCAG 2.1 na poziomie AA.

Poniższa lista przedstawia elementy zweryfikowane oraz te, które wymagają dalszej
weryfikacji lub poprawy:

**Zweryfikowane / spełnione:**
- Wszystkie obrazy w interfejsie mają tekst alternatywny (`alt`).
- Elementy interaktywne (przyciski, pola formularzy, linki) mają widoczny stan
  fokusu (`:focus-visible`) dla nawigacji klawiaturą.
- Interfejs jest responsywny i działa na urządzeniach mobilnych.
- Aplikacja respektuje systemowe ustawienie `prefers-reduced-motion` (ogranicza
  animacje dla osób wrażliwych na ruch).
- Kontrast kolorów tekstu i tła zmierzono empirycznie (w przeglądarce, na
  rzeczywiście wyrenderowanych stronach, we wszystkich głównych widokach panelu
  administratora i panelu klienta, w obu motywach — jasnym i ciemnym) względem
  progów WCAG AA (4.5:1 dla tekstu zwykłego, 3:1 dla tekstu dużego i elementów
  graficznych). Wykryte niedopasowania kolorów zostały poprawione.

**Niezweryfikowane / do poprawy (uczciwie: nie przeprowadzono formalnego audytu):**
- Pełna nawigacja wyłącznie klawiaturą (bez myszy) nie została systematycznie
  przetestowana na wszystkich widokach.
- Zgodność z czytnikami ekranu (np. NVDA, VoiceOver) nie została przetestowana.
- Struktura nagłówków (`h1`-`h3`) i etykiet ARIA nie została poddana pełnemu audytowi.

## Data sporządzenia i metoda oceny

Deklarację sporządzono dnia: [PLACEHOLDER: DATA].

Deklaracja została sporządzona na podstawie przeglądu kodu źródłowego aplikacji
(samoocena, bez formalnego audytu WCAG przez niezależny podmiot).

## Informacje zwrotne i dane kontaktowe

W przypadku problemów z dostępnością aplikacji prosimy o kontakt:
- E-mail: [PLACEHOLDER: adres e-mail wsparcia]
- Telefon: [PLACEHOLDER: numer telefonu wsparcia]

Tą samą drogą można składać wnioski o udostępnienie informacji niedostępnej oraz
żądania zapewnienia dostępności.

## Dostępność architektoniczna

[PLACEHOLDER: jeśli firma obsługuje klientów w siedzibie fizycznej, opisać tutaj
dostępność budynku — podjazdy, windy, oznaczenia dla osób niewidomych itd. Jeśli
kontakt odbywa się wyłącznie zdalnie/przez system zgłoszeń, można tę sekcję pominąć
lub napisać, że obsługa klienta odbywa się zdalnie.]
