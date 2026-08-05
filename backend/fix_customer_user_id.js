import { db } from "./src/db.js";

const fixSchema = async () => {
  const client = await db.connect();
  try {
    console.log('Sprawdzanie kolumny "user_id" w tabeli "customers"...');

    const checkColumnQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'customers' AND column_name = 'user_id';
    `;

    const { rows } = await client.query(checkColumnQuery);

    if (rows.length > 0) {
      console.log('Kolumna "user_id" już istnieje w tabeli "customers". Nie są wymagane żadne zmiany.');
    } else {
      console.log('Brak kolumny "user_id". Dodawanie kolumny...');
      const addColumnQuery = `ALTER TABLE customers ADD COLUMN user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL;`;
      await client.query(addColumnQuery);
      console.log('Kolumna "user_id" została pomyślnie dodana do tabeli "customers".');
    }
  } catch (error) {
    console.error("Wystąpił błąd podczas próby naprawy schemy:", error);
  } finally {
    await client.release();
    await db.end();
    console.log("Zakończono skrypt naprawczy.");
  }
};

fixSchema();