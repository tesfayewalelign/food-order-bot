import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");
dotenv.config();

const url = process.env.TURSO_DATABASE_URL || "file:dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({
  url,
  authToken,
});

export async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS profiles (
      telegram_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );`,

    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT NOT NULL,
      restaurant TEXT NOT NULL,
      meal_type TEXT,
      restaurant_id INTEGER,
      foods_summary TEXT NOT NULL,
      has_restaurant_contract INTEGER DEFAULT 0,
      has_delivery_contract INTEGER DEFAULT 0,
      food_total REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      rider_id INTEGER,
      rider_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      food_id INTEGER,
      food_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_order REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );`,

    `CREATE TABLE IF NOT EXISTS riders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT NOT NULL,
      secret_code TEXT UNIQUE,
      active INTEGER DEFAULT 1
    );`,

    `CREATE TABLE IF NOT EXISTS restaurant_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      restaurant_id INTEGER,
      restaurant_name TEXT NOT NULL,
      remaining_meals INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS delivery_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      campus TEXT NOT NULL,
      remaining_deliveries INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS contract_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT NOT NULL,
      request_type TEXT NOT NULL,
      restaurant_id INTEGER,
      restaurant_name TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS delivery_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campus TEXT NOT NULL,
      restaurant_id INTEGER,
      price_per_food REAL NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );`
  ]);

  try { await db.execute("ALTER TABLE restaurants ADD COLUMN active INTEGER DEFAULT 1"); } catch(e) {}
  try { await db.execute("ALTER TABLE foods ADD COLUMN active INTEGER DEFAULT 1"); } catch(e) {}
  try { await db.execute("ALTER TABLE complaints ADD COLUMN status TEXT DEFAULT 'pending'"); } catch(e) {}
  try { await db.execute("ALTER TABLE orders ADD COLUMN delivery_price_per_food REAL DEFAULT 0"); } catch(e) {}
  try { await db.execute("ALTER TABLE contract_requests ADD COLUMN username TEXT"); } catch(e) {}

  // Seed default campus delivery prices if empty
  const dpCheck = await db.execute("SELECT COUNT(*) as count FROM delivery_pricing");
  const dpCount = Number(dpCheck.rows[0]?.count ?? 0);
  if (dpCount === 0) {
    await db.batch([
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_main_boys_whites_house", 10] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_main_boys_africa", 15] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_main_girls_white_house", 10] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_main_girls_africa_house", 15] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_techno_boys", 20] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_techno_girls", 25] },
      { sql: "INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food) VALUES (?, NULL, ?)", args: ["campus_agri", 15] },
    ]);
  }

  // Seed sample restaurants if empty
  const restCheck = await db.execute("SELECT COUNT(*) as count FROM restaurants");
  const count = Number(restCheck.rows[0]?.count ?? 0);
  if (count === 0) {
    await db.batch([
      { sql: "INSERT INTO restaurants (name) VALUES (?)", args: ["Askuala"] },
      { sql: "INSERT INTO restaurants (name) VALUES (?)", args: ["Fike"] },
      { sql: "INSERT INTO restaurants (name) VALUES (?)", args: ["Mesi"] },
      { sql: "INSERT INTO restaurants (name) VALUES (?)", args: ["Pepsi"] },
      { sql: "INSERT INTO restaurants (name) VALUES (?)", args: ["Shewit"] },
    ]);

    const r1 = await db.execute("SELECT id FROM restaurants WHERE name = 'Askuala'");
    const r1Id = Number(r1.rows[0]?.id);
    if (r1Id) {
      await db.batch([
        { sql: "INSERT INTO foods (restaurant_id, name, price) VALUES (?, ?, ?)", args: [r1Id, "Special Shiro", 120] },
        { sql: "INSERT INTO foods (restaurant_id, name, price) VALUES (?, ?, ?)", args: [r1Id, "Beef Tibs", 250] },
        { sql: "INSERT INTO foods (restaurant_id, name, price) VALUES (?, ?, ?)", args: [r1Id, "Pasta with Meat", 150] },
      ]);
    }
  }

  console.log("✅ Database initialized successfully (SQLite/Turso)");
}
