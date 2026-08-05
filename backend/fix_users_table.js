import { db } from "./src/db.js";

const fixUsersTable = async () => {
  const client = await db.connect();
  try {
    console.log('Sprawdzanie struktury tabeli "users"...');

    const checkColumn = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'created_at'`
    );

    if (checkColumn.rowCount === 0) {
      console.log('Brak kolumny "created_at" w tabeli "users". Dodawanie...');
      await client.query('ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      console.log('Kolumna "created_at" została pomyślnie dodana do tabeli "users".');
    } else {
      console.log('Kolumna "created_at" już istnieje.');
    }

    console.log("Weryfikacja tabeli 'users' zakończona pomyślnie.");
  } catch (error) {
    console.error("Wystąpił błąd podczas naprawy tabeli 'users':", error);
  } finally {
    await client.release();
    await db.end();
  }
};

fixUsersTable();