# Prestige Systems HUB - wydanie serwerowe

Wersja: 1.0.1

Ten folder zawiera czysta wersje aplikacji gotowa do wdrozenia. Nie zawiera bazy danych, pliku `.env`, uploadow, backupow, logow ani `node_modules`.

Ta instrukcja zaklada, ze zaczynasz od **calkowicie nowego urzadzenia z Windows**, bez wczesniej zainstalowanego Node.js czy PostgreSQL. Jezeli te skladniki juz masz, przejdz od razu do sekcji [Krok 3](#krok-3-skopiuj-pliki-aplikacji).

## Spis tresci

1. [Wymagania](#wymagania)
2. [Krok 1: Zainstaluj Node.js](#krok-1-zainstaluj-nodejs)
3. [Krok 2: Zainstaluj PostgreSQL](#krok-2-zainstaluj-postgresql)
4. [Krok 3: Skopiuj pliki aplikacji](#krok-3-skopiuj-pliki-aplikacji)
5. [Krok 4: Skonfiguruj plik .env](#krok-4-skonfiguruj-plik-env)
6. [Krok 5: Zainstaluj zaleznosci i przygotuj baze danych](#krok-5-zainstaluj-zaleznosci-i-przygotuj-baze-danych)
7. [Krok 6: Utworz konto administratora](#krok-6-utworz-konto-administratora)
8. [Krok 7: Zainstaluj usluge Windows](#krok-7-zainstaluj-usluge-windows)
9. [Krok 8: Sprawdz, czy dziala](#krok-8-sprawdz-czy-dziala)
10. [Dostep z innych urzadzen w sieci lokalnej](#dostep-z-innych-urzadzen-w-sieci-lokalnej)
11. [HTTPS i dostep z internetu](#https-i-dostep-z-internetu)
12. [Aktualizacja do nowej wersji](#aktualizacja-do-nowej-wersji)
13. [Zarzadzanie usluga](#zarzadzanie-usluga)
14. [Rozwiazywanie problemow](#rozwiazywanie-problemow)

## Zawartosc folderu

- `backend` - API, migracje bazy, serwis Windows oraz zasoby PDF.
- `frontend/dist` - gotowy, produkcyjny panel webowy serwowany przez backend.
- `service` - skrypty instalacji, restartu i usuniecia uslugi Windows.
- `network` - konfiguracja HTTPS (Caddy) dla dostepu z internetu.
- `app-version.json`, `VERSION.txt`, `RELEASE_MANIFEST.json` - numer aplikacji, wersja schematu bazy i metadane wydania.

## Wymagania

- Windows 10/11 lub Windows Server, z kontem administratora.
- Polaczenie z internetem (do pobrania Node.js, PostgreSQL i zaleznosci npm).
- Wolny port `5000` na urzadzeniu (albo inny, ustawiony w `.env`).
- Ok. 1 GB wolnego miejsca na dysku (aplikacja + zaleznosci + baza danych rosnie z czasem).

Nie instaluj aplikacji w folderze OneDrive, Dropbox ani innym synchronizowanym w chmurze - powoduje to bledy blokady plikow i niepotrzebna synchronizacje bazy/logow. Uzyj zwyklego lokalnego folderu, np. `C:\PrestigeSystemsHub`.

## Krok 1: Zainstaluj Node.js

1. Wejdz na https://nodejs.org i pobierz instalator wersji **LTS** (Long Term Support) dla Windows (plik `.msi`).
2. Uruchom instalator, zaakceptuj domyslne ustawienia. Zaznacz opcje instalacji narzedzi wiersza polecen, jesli instalator o to zapyta.
3. Po instalacji otworz nowy terminal (PowerShell lub cmd) i sprawdz wersje:

```cmd
node -v
npm -v
```

Powinienes zobaczyc numery wersji (np. `v20.x.x` i `10.x.x`). Jezeli polecenie nie jest rozpoznawane, zamknij i otworz terminal ponownie (albo zrestartuj urzadzenie) - instalator dodaje Node.js do zmiennej `PATH`, co czasem wymaga nowej sesji terminala.

## Krok 2: Zainstaluj PostgreSQL

1. Wejdz na https://www.postgresql.org/download/windows/ i pobierz instalator (wersja 14 lub nowsza).
2. Uruchom instalator. W trakcie instalacji:
   - Zapamietaj **haslo konta `postgres`**, ktore ustawisz - bedzie potrzebne w pliku `.env`.
   - Domyslny port `5432` mozna zostawic bez zmian.
   - Komponent "Stack Builder" na koncu instalacji nie jest potrzebny - mozna go pominac.
3. Po instalacji sprawdz, czy usluga PostgreSQL dziala: otworz "Uslugi" (`services.msc`) i poszukaj uslugi `postgresql-x64-<wersja>` ze statusem "Uruchomiona". Jest ustawiona na autostart, wiec nie trzeba jej uruchamiac recznie przy kazdym starcie serwera.

Nie musisz recznie tworzyc bazy danych ani tabel - zrobi to za Ciebie polecenie `npm run db:setup` w [kroku 5](#krok-5-zainstaluj-zaleznosci-i-przygotuj-baze-danych), pod warunkiem ze konto `postgres` ma uprawnienia do tworzenia baz (domyslnie ma).

## Krok 3: Skopiuj pliki aplikacji

Skopiuj caly ten folder do stalej lokalizacji, na przyklad `C:\PrestigeSystemsHub`.

## Krok 4: Skonfiguruj plik .env

1. Skopiuj `backend\.env.example` jako `backend\.env`.
2. Otworz `backend\.env` w edytorze tekstu i uzupelnij wartosci:

| Zmienna | Co wpisac |
| --- | --- |
| `DATABASE_URL` | Adres polaczenia do PostgreSQL, np. `postgresql://postgres:TWOJE_HASLO@localhost:5432/prestige_systems_hub`. Jezeli haslo zawiera znaki specjalne (`@`, `#`, `/` itp.), zakoduj je w adresie URL (np. `@` -> `%40`). |
| `JWT_SECRET` | Dlugi, losowy sekret uzywany do podpisywania sesji logowania. Wygeneruj go poleceniem ponizej. |
| `EMAIL_ENCRYPTION_KEY` | Dlugi, losowy klucz do szyfrowania zapisanej konfiguracji poczty. Wygeneruj tak samo jak `JWT_SECRET`, osobnym wywolaniem. |
| `ALLOWED_ORIGINS` | Adresy, z ktorych wolno otwierac panel, rozdzielone przecinkami (np. `http://localhost:5000,http://192.168.0.50:5000`). Patrz sekcja [Dostep z innych urzadzen](#dostep-z-innych-urzadzen-w-sieci-lokalnej). |
| `PORT` | Port aplikacji, domyslnie `5000`. Zmien tylko jesli port jest zajety. |

Wygenerowanie losowego sekretu (uruchom dwa razy - osobno dla `JWT_SECRET` i `EMAIL_ENCRYPTION_KEY`):

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Nigdy nie kopiuj pliku `.env` do repozytorium, kolejnych paczek wydaniowych ani nikomu nie wysylaj - zawiera sekrety dajace pelny dostep do bazy danych i sesji uzytkownikow.

## Krok 5: Zainstaluj zaleznosci i przygotuj baze danych

Otworz terminal **jako administrator** i uruchom:

```cmd
cd C:\PrestigeSystemsHub\backend
npm ci --omit=dev
npm run db:setup
```

`npm run db:setup` tworzy baze danych (jesli jeszcze nie istnieje) i wykonuje wszystkie migracje schematu. Na koncu powinienes zobaczyc komunikat "Baza danych jest gotowa do uruchomienia aplikacji."

## Krok 6: Utworz konto administratora

```cmd
npm run admin:create -- --username=admin --email=admin@twoja-firma.pl --password=ZmienToHaslo123!
```

Uzyj wlasnego, silnego hasla. Tym loginem i haslem zalogujesz sie do panelu po pierwszym uruchomieniu.

## Krok 7: Zainstaluj usluge Windows

```cmd
cd C:\PrestigeSystemsHub
service\install-service.cmd
```

Skrypt instaluje zaleznosci produkcyjne backendu (jesli jeszcze tego nie zrobiles) i rejestruje aplikacje jako usluge Windows o nazwie "Prestige Systems HUB", ktora uruchamia sie automatycznie przy starcie systemu.

## Krok 8: Sprawdz, czy dziala

1. Otworz w przegladarce `http://localhost:5000` (albo `http://ADRES_SERWERA:5000` z innego urzadzenia w sieci - patrz nastepna sekcja).
2. Powinien pojawic sie ekran logowania. Zaloguj sie kontem administratora utworzonym w kroku 6.
3. Sprawdz wersje wdrozonej aplikacji pod adresem `http://localhost:5000/app-version.json` - powinna zgadzac sie z `VERSION.txt` w tym folderze.

## Dostep z innych urzadzen w sieci lokalnej

Aby inne komputery/telefony w tej samej sieci lokalnej mogly otworzyc panel:

1. Sprawdz lokalny adres IP serwera: `ipconfig` w terminalu, pole "Adres IPv4" (np. `192.168.0.50`).
2. Upewnij sie, ze zapora Windows (Windows Firewall) zezwala na polaczenia przychodzace na porcie aplikacji (domyslnie `5000`) w sieci prywatnej.
3. Dodaj adres z tym IP do `ALLOWED_ORIGINS` w `backend\.env`, np.:

   ```
   ALLOWED_ORIGINS=http://localhost:5000,http://192.168.0.50:5000
   ```

4. Zrestartuj usluge, aby zaladowala nowa konfiguracje: `service\restart-service.cmd`.
5. Na innym urzadzeniu w tej samej sieci otworz `http://192.168.0.50:5000`.

Zalogowany administrator moze tez zmienic te ustawienia z poziomu panelu, bez edycji pliku `.env` recznie: **Ustawienia > System > Siec**. Zmiany zapisane w panelu wymagaja restartu uslugi, zeby zaczely obowiazywac (panel wyswietli o tym przypomnienie).

## HTTPS i dostep z internetu

W produkcji nie wystawiaj portu `5000` do internetu. Backend powinien nasluchiwac tylko na `127.0.0.1`, a HTTPS obsluguje reverse proxy Caddy. Po ustawieniu domeny i DNS uruchom jako administrator:

```cmd
cd C:\PrestigeSystemsHub\network
install-https.cmd -Domain "hub.twoja-domena.pl" -Email "admin@twoja-domena.pl"
```

Szczegolowa instrukcja jest w `network\README.md`.

## Aktualizacja do nowej wersji

1. Na komputerze developerskim uruchom `npm run release:prepare`. Powstanie nowy folder `app-release` z aktualnym numerem wersji.
2. Skopiuj caly folder wydania na serwer do osobnego katalogu, na przyklad `C:\PrestigeSystemsHub-release-1.0.1`. Nie kopiuj go bezposrednio do `C:\PrestigeSystemsHub`.
3. Otworz terminal jako administrator i uruchom skrypt z nowego katalogu wydania:

```cmd
cd C:\PrestigeSystemsHub-release-1.0.1\service
update-service.cmd -InstallPath "C:\PrestigeSystemsHub"
```

Skrypt automatycznie tworzy backup, sprawdza jego integralnosc i test odtworzenia, zapisuje kopie poprzednich plikow w `.update-rollback`, aktualizuje kod, uruchamia tylko brakujace migracje, restartuje usluge i sprawdza numer wersji oraz schematu pod `/app-version.json`.

Historia wykonanych migracji jest zapisywana w tabeli `schema_migrations`. Po aktualizacji mozna ja sprawdzic poleceniem:

```cmd
cd C:\PrestigeSystemsHub\backend
npm run db:status
```

Plik `backend\.env`, uploady, backupy, logi i katalog `node_modules` nie sa nadpisywane przez wydanie. Jezeli blad wystapi przed migracja, skrypt automatycznie przywraca poprzednie pliki. Po rozpoczeciu migracji nie wykonuje automatycznego cofniecia kodu, poniewaz pelne wycofanie wymaga wtedy uzycia backupu przed aktualizacja.

## Zarzadzanie usluga

```cmd
service\restart-service.cmd
service\uninstall-service.cmd
```

Skrypty sa bezpieczne dla standardowej polityki PowerShell, poniewaz pliki `.cmd` uruchamiaja wymagany skrypt z parametrem `ExecutionPolicy Bypass`.

## Rozwiazywanie problemow

**"Uruchom ten skrypt jako administrator" / skrypt konczy sie natychmiast**
Kliknij prawym przyciskiem na "Wiersz polecenia" albo "PowerShell" i wybierz "Uruchom jako administrator", dopiero potem wpisz polecenia.

**`npm run db:setup` konczy sie bledem polaczenia ("connection refused" / "ECONNREFUSED")**
PostgreSQL nie dziala albo `DATABASE_URL` wskazuje na zly port/host. Sprawdz w `services.msc`, czy usluga `postgresql-x64-...` ma status "Uruchomiona", oraz czy port w `DATABASE_URL` zgadza sie z portem PostgreSQL (domyslnie `5432`).

**`npm run db:setup` konczy sie bledem uwierzytelniania ("password authentication failed")**
Haslo w `DATABASE_URL` nie zgadza sie z haslem konta `postgres` ustawionym podczas instalacji PostgreSQL. Popraw haslo w `backend\.env`. Jesli zawiera znaki specjalne, zakoduj je w adresie URL.

**Usluga "Prestige Systems HUB" nie startuje albo natychmiast sie zatrzymuje**
Otworz Podglad zdarzen Windows (`eventvwr.msc`) -> Dzienniki aplikacji i uslug, poszukaj wpisow zwiazanych z uslugą. Najczesciej przyczyna to brakujacy albo bledny `backend\.env`, zajety port, lub niedokonczona instalacja zaleznosci (`npm ci --omit=dev` w `backend`).

**Strona nie laduje sie / "Nie mozna dotrzec do tej strony"**
Sprawdz, czy usluga dziala (`services.msc`, usluga "Prestige Systems HUB"). Sprawdz, czy uzywasz poprawnego adresu i portu (`http://localhost:5000` lokalnie, albo adres IP serwera z portem dla innych urzadzen). Sprawdz zapore Windows, jesli laczysz sie z innego urzadzenia w sieci.

**Logowanie dziala, ale zaraz po zalogowaniu wylogowuje / "Brak uprawnien" po zalogowaniu z innego adresu**
Adres, z ktorego otwierasz panel, nie jest wpisany w `ALLOWED_ORIGINS` w `backend\.env`. Dodaj go (patrz [Dostep z innych urzadzen](#dostep-z-innych-urzadzen-w-sieci-lokalnej)) i zrestartuj usluge.

**Port `5000` jest zajety przez inny program**
Zmien `PORT` w `backend\.env` na wolny port (np. `5050`), zrestartuj usluge i uzywaj nowego portu w adresie przegladarki.

**Zapomniane haslo administratora**
Uruchom ponownie polecenie z kroku 6 z tym samym `--username`, ale nowym `--password` - konto zostanie zaktualizowane (nie utworzy sie duplikat).
