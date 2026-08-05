import { db } from "./src/db.js";

const fixCompaniesTable = async () => {
  const client = await db.connect();
  try {
    console.log('Sprawdzanie struktury tabeli "companies"...');

    const checkColumn = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'address'`
    );

    if (checkColumn.rowCount === 0) {
      console.log('Brak kolumny "address" w tabeli "companies". Dodawanie...');
      await client.query('ALTER TABLE companies ADD COLUMN address TEXT');
      console.log('Kolumna "address" została pomyślnie dodana do tabeli "companies".');
    } else {
      console.log('Kolumna "address" już istnieje.');
    }

    console.log("Weryfikacja tabeli 'companies' zakończona pomyślnie.");
  } catch (error) {
    console.error("Wystąpił błąd podczas naprawy tabeli 'companies':", error);
  } finally {
    await client.release();
    await db.end();
  }
};

fixCompaniesTable();