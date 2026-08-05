# Prestige Systems HUB - wydanie serwerowe

Wersja: 1.0.1

Ten folder zawiera czysta wersje aplikacji gotowa do wdrozenia. Nie zawiera bazy danych, pliku `.env`, uploadow, backupow, logow ani `node_modules`.

## Zawartosc

- `backend` - API, migracje bazy, serwis Windows oraz zasoby PDF.
- `frontend/dist` - gotowy, produkcyjny panel webowy serwowany przez backend.
- `service` - skrypty instalacji, restartu i usuniecia uslugi Windows.
- `app-version.json`, `VERSION.txt`, `RELEASE_MANIFEST.json` - numer aplikacji, wersja schematu bazy i metadane wydania.

## Wymagania

- Windows Server lub Windows z uprawnieniami administratora.
- Node.js w aktualnej wersji LTS.
- PostgreSQL z kontem mogacym utworzyc docelowa baze danych.
- Wolny port `5000` albo inny ustawiony w `.env`.

## Pierwsza instalacja

1. Skopiuj caly folder do stalej lokalizacji, na przyklad `C:\PrestigeSystemsHub`. Nie instaluj aplikacji w OneDrive ani w katalogu tymczasowym.
2. Skopiuj `backend\.env.example` jako `backend\.env` i uzupelnij wartosci.
3. Otworz terminal jako administrator i uruchom:

```cmd
cd C:\PrestigeSystemsHub\backend
npm ci --omit=dev
npm run db:setup
```

4. Przy pierwszej instalacji utworz konto administratora:

```cmd
npm run admin:create -- --username=admin --email=admin@twoja-firma.pl --password=ZmienToHaslo123!
```

5. Zainstaluj usluge Windows:

```cmd
cd C:\PrestigeSystemsHub
service\install-service.cmd
```

6. Otworz `http://ADRES_SERWERA:5000` i sprawdz wersje pod adresem `http://ADRES_SERWERA:5000/app-version.json`.

## Konfiguracja .env

Najwazniejsze wartosci:

- `DATABASE_URL` - polaczenie do PostgreSQL. Jezeli haslo ma znaki specjalne, zakoduj je w adresie URL.
- `JWT_SECRET` - dlugi, losowy sekret. Wygenerujesz go poleceniem:

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- `EMAIL_ENCRYPTION_KEY` - dlugi, losowy klucz do szyfrowania konfiguracji poczty.
- `ALLOWED_ORIGINS` - adresy panelu, rozdzielone przecinkami. Dla instalacji na tym samym serwerze wystarczy adres aplikacji.

## HTTPS i dostep sieciowy

W produkcji nie wystawiaj portu `5000` do internetu. Backend powinien nasluchiwac tylko na `127.0.0.1`, a HTTPS obsluguje reverse proxy Caddy. Po ustawieniu domeny i DNS uruchom jako administrator:

```cmd
cd C:\PrestigeSystemsHub\network
install-https.cmd -Domain "hub.twoja-domena.pl" -Email "admin@twoja-domena.pl"
```

Szczegolowa instrukcja jest w `network\README.md`.

Nie dodawaj pliku `.env` do repozytorium ani do kolejnych paczek wydaniowych.

## Aktualizacja

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
