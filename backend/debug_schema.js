import { db } from "./src/db.js";

const q = async () => {
  try {
    const existing = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='company_id'"
    );
    if (existing.rowCount === 0) {
      console.log("Dodaję kolumnę company_id do tabeli customers...");
      await db.query("ALTER TABLE customers ADD COLUMN company_id INT REFERENCES companies(id)");
      console.log("Kolumna company_id została dodana.");
    } else {
      console.log("Kolumna company_id już istnieje.");
    }

    const customers = await db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='customers' ORDER BY ordinal_position"
    );
    console.log("CUSTOMERS", JSON.stringify(customers.rows, null, 2));

    const companies = await db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='companies' ORDER BY ordinal_position"
    );
    console.log("COMPANIES", JSON.stringify(companies.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await db.end();
  }
};

q();
