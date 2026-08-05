# Uruchomienie aplikacji na nowym urządzeniu

## Wymagania

- Node.js
- PostgreSQL
- skopiowany cały folder aplikacji

## 1. Backend

Wejdź do folderu backendu:

```cmd
cd backend
npm install
```

Utwórz plik `.env` w folderze `backend`:

```env
PORT=5000
JWT_SECRET=supersecretkey
DATABASE_URL=postgresql://postgres:PCP123edc@localhost:5432/offersdb
EMAIL_ENCRYPTION_KEY="PrestigeEmailKey2026SecureHub01X"
```

Jeśli na nowym komputerze PostgreSQL ma inne hasło użytkownika `postgres`, zmień je w `DATABASE_URL`.

Utwórz bazę i tabele:

```cmd
npm run db:setup
```

Utwórz konto administratora:

```cmd
npm run admin:create -- --username=Verwi --email=verwi@local --password=TU_WPISZ_HASLO
```

Uruchom backend:

```cmd
npm start
```

Backend powinien działać na:

```txt
http://localhost:5000
```

## 2. Frontend

Otwórz drugi terminal i wejdź do frontendu:

```cmd
cd frontend
npm install
npm run dev
```

Frontend powinien działać na:

```txt
http://localhost:5173
```

## 3. Logowanie

Zaloguj się danymi utworzonymi w kroku `admin:create`.

Przykład:

```txt
Login: Verwi
Hasło: hasło podane w --password
```

## Ważne

Plik `database.sql` w projekcie jest przestarzały. Do nowej instalacji używaj:

```cmd
npm run db:setup
```

oraz:

```cmd
npm run admin:create -- --username=Verwi --password=TU_WPISZ_HASLO
```
