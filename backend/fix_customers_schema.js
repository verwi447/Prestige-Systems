import { db } from "./src/db.js";

const run = async () => {
  try {
    console.log("Sprawdzam kolumnę company_id w tabeli customers...");
    const col = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='company_id'"
    );
    if (col.rowCount === 0) {
      console.log("Dodaję kolumnę company_id...");
      await db.query("ALTER TABLE customers ADD COLUMN company_id INT REFERENCES companies(id)");
      console.log("Kolumna company_id została dodana.");
    } else {
      console.log("Kolumna company_id już istnieje.");
    }

    console.log("Sprawdzam starą kolumnę company...");
    const old = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='company'"
    );
    if (old.rowCount > 0) {
      console.log("Usuwam starą kolumnę company...");
      await db.query("ALTER TABLE customers DROP COLUMN company");
      console.log("Stara kolumna company została usunięta.");
    } else {
      console.log("Stara kolumna company nie istnieje.");
    }

    const res = await db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='customers' ORDER BY ordinal_position"
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await db.end();
  }
};

run();
