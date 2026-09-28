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
- Obsługa z klawiatury: każdy element uruchamiający akcję jest osiągalny
  klawiszem Tab i działa po naciśnięciu Enter lub spacji. Dotyczy to także
  wierszy tabel (zgłoszenia, zamówienia, oferty, firmy) oraz kart na tablicy
  kanban, które wcześniej reagowały wyłącznie na kliknięcie myszą.
- Okna dialogowe (potwierdzenia, formularze) mają semantykę `role="dialog"`
  z `aria-modal` i powiązanym tytułem, automatycznie przejmują fokus po
  otwarciu, zatrzymują go w swoim obrębie (Tab nie „ucieka" na stronę pod
  spodem), zamykają się klawiszem Escape i przywracają fokus na element,
  który je otworzył.
- Etykiety dostępne: wszystkie pola formularzy, listy wyboru i przyciski
  ikonowe (w tym paginacja) mają nazwę czytaną przez czytnik ekranu.
- Struktura nagłówków: każdy ekran ma dokładnie jeden nagłówek `h1`,
  a poziomy nagłówków nie są pomijane.
- Wszystkie ekrany mają punkt orientacyjny `main` dla nawigacji czytnikiem.

**Niezweryfikowane / do poprawy (uczciwie: nie przeprowadzono formalnego audytu):**
- Zgodność z czytnikami ekranu (NVDA, JAWS, VoiceOver) nie została
  przetestowana z użyciem rzeczywistego oprogramowania asystującego — powyższe
  punkty zweryfikowano programowo (drzewo dostępności, fokus, zdarzenia
  klawiatury), co nie zastępuje testu z użytkownikiem czytnika ekranu.
- Nie przeprowadzono audytu przez niezależny podmiot zewnętrzny.

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
