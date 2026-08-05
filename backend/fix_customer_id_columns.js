import { db } from "./src/db.js";

const fixCustomerIdColumns = async () => {
  const client = await db.connect();
  try {
    console.log('Sprawdzanie kolumny "customer_id" w tabelach "offers" i "tickets"...');

    // Check 'offers' table
    const checkOffers = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'customer_id'`
    );
    if (checkOffers.rowCount === 0) {
      console.log('Brak kolumny "customer_id" w tabeli "offers". Dodawanie...');
      await client.query('ALTER TABLE offers ADD COLUMN customer_id INT REFERENCES customers(id)');
      console.log('Kolumna "customer_id" została dodana do tabeli "offers".');
    } else {
      console.log('Kolumna "customer_id" w tabeli "offers" już istnieje.');
    }

    // Check 'tickets' table
    const checkTickets = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'customer_id'`
    );
    if (checkTickets.rowCount === 0) {
      console.log('Brak kolumny "customer_id" w tabeli "tickets". Dodawanie...');
      await client.query('ALTER TABLE tickets ADD COLUMN customer_id INT REFERENCES customers(id) ON DELETE SET NULL');
      console.log('Kolumna "customer_id" została dodana do tabeli "tickets".');
    } else {
      console.log('Kolumna "customer_id" w tabeli "tickets" już istnieje.');
    }

    console.log("Weryfikacja kolumn 'customer_id' zakończona pomyślnie.");
  } catch (error) {
    console.error("Wystąpił błąd podczas naprawy tabel:", error);
  } finally {
    await client.release();
    await db.end();
  }
};

fixCustomerIdColumns();