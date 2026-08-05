# HTTPS i wdrozenie sieciowe

Ten katalog konfiguruje Caddy jako reverse proxy dla Prestige Systems HUB na Windows. Backend pozostaje dostepny tylko lokalnie pod `127.0.0.1:5000`, a Caddy wystawia aplikacje na portach `80` i `443` z automatycznie odnawianym certyfikatem HTTPS.

## Wymagania

- Publiczna domena, np. `hub.twoja-domena.pl`.
- Rekord DNS `A` domeny wskazujacy na publiczny adres IP serwera.
- Porty `80/TCP`, `443/TCP` oraz opcjonalnie `443/UDP` przekierowane na serwer i dostepne z internetu.
- Uprawnienia administratora Windows.
- Oficjalny plik `caddy.exe` zapisany w `C:\Caddy\caddy.exe`.

Pobierz Caddy wylacznie z oficjalnej strony i zweryfikuj podpis lub hash przed instalacja: https://caddyserver.com/download

## Instalacja

Po zainstalowaniu aplikacji uruchom PowerShell jako administrator:

```cmd
cd C:\PrestigeSystemsHub\network
install-https.cmd -Domain "hub.twoja-domena.pl" -Email "admin@twoja-domena.pl"
```

Skrypt sprawdza konfiguracje, ogranicza backend do localhost, ustawia zaufanie do lokalnego proxy, otwiera wymagane reguly zapory Windows oraz instaluje usluge `PrestigeSystemsHubProxy` z automatycznym restartem po bledzie.

Nie wystawiaj portu `5000` przez router ani zapore. Jedynymi portami publicznymi aplikacji maja byc `80` i `443`.

## Zmiana konfiguracji

Po zmianie `Caddyfile` uruchom jako administrator:

```cmd
reload-https.cmd
```

Certyfikaty i klucze Caddy sa przechowywane w profilu konta uruchamiajacego usluge. Nie usuwaj tego katalogu podczas aktualizacji aplikacji.
