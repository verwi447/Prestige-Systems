import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 15),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 20_000,
  query_timeout: 25_000,
  idle_in_transaction_session_timeout: 15_000,
  application_name: "prestige-systems-hub"
});

db.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});
