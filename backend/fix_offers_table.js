import { db } from "./src/db.js";

const fixOffersTable = async () => {
  const client = await db.connect();
  try {
    console.log('Sprawdzanie struktury tabeli "offers"...');

    // Check for created_at column
    const checkCreatedAt = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'created_at'`
    );
    if (checkCreatedAt.rowCount === 0) {
      console.log('Brak kolumny "created_at". Dodawanie...');
      await client.query('ALTER TABLE offers ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      console.log('Kolumna "created_at" została dodana.');
    } else {
      console.log('Kolumna "created_at" już istnieje.');
    }

    // Check for updated_at column
    const checkUpdatedAt = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'updated_at'`
    );
    if (checkUpdatedAt.rowCount === 0) {
      console.log('Brak kolumny "updated_at". Dodawanie...');
      await client.query('ALTER TABLE offers ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      console.log('Kolumna "updated_at" została dodana.');
    } else {
      console.log('Kolumna "updated_at" już istnieje.');
    }

    console.log("Weryfikacja tabeli 'offers' zakończona pomyślnie.");
  } catch (error) {
    console.error("Wystąpił błąd podczas naprawy tabeli 'offers':", error);
  } finally {
    await client.release();
    await db.end();
  }
};

fixOffersTable();