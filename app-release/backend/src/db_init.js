import { db } from "./db.js";

const queries = [
`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'USER',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  created_by INT REFERENCES users(id),
  assigned_to_id INT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'NORMAL',
  blocks_work BOOLEAN DEFAULT FALSE,
  contact_name TEXT,
  contact_phone TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_id INT REFERENCES companies(id) ON DELETE SET NULL,
  company_role TEXT,
  user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS objects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  company_id INT REFERENCES companies(id) ON DELETE SET NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'NOWY',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  catalog_price DECIMAL(10, 2) DEFAULT 0,
  sale_price DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS offer_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS template_items (
  id SERIAL PRIMARY KEY,
  template_id INT REFERENCES offer_templates(id) ON DELETE CASCADE,
  item_number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  unit_price DECIMAL(10, 2),
  quantity INT DEFAULT 1,
  sort_order INT
);
`,
`
CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  offer_number TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  object_id INT REFERENCES objects(id),
  customer_id INT REFERENCES customers(id),
  template_id INT REFERENCES offer_templates(id),
  status TEXT DEFAULT 'W REALIZACJI' CHECK (status IN ('W REALIZACJI', 'DO AKCEPTACJI', 'ZAAKCEPTOWANA', 'ODRZUCONA')),
  total_price DECIMAL(10, 2),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS offer_items (
  id SERIAL PRIMARY KEY,
  offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
  item_number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  unit_price DECIMAL(10, 2),
  quantity INT DEFAULT 1,
  total DECIMAL(10, 2)
);
`,
`
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INT,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
  author_id INT REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS rejections (
  id SERIAL PRIMARY KEY,
  offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  rejected_by INT REFERENCES users(id),
  rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_number TEXT UNIQUE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  object_id INT REFERENCES objects(id) ON DELETE SET NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id),
  status TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PARTS', 'REJECTED', 'COMPLETED', 'CANCELLED')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
`
CREATE TABLE IF NOT EXISTS ticket_photos (
  id SERIAL PRIMARY KEY,
  ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INT,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`
];

const initializeDatabase = async () => {
    const client = await db.connect();
    try {
        console.log("Rozpoczynanie inicjalizacji bazy danych...");
        for (const query of queries) {
            await client.query(query);
        }
        console.log("Inicjalizacja bazy danych zakończona pomyślnie. Wszystkie tabele zostały sprawdzone/utworzone.");
    } catch (error) {
        console.error("Wystąpił błąd podczas inicjalizacji bazy danych:", error);
    } finally {
        await client.release();
        await db.end();
        console.log("Połączenie z bazą danych zostało zamknięte.");
    }
};

initializeDatabase();
