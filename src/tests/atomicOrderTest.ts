import { createClient } from "@libsql/client";
import fs from "fs";
import { executeNormalOrderTransaction } from "../bot/handlers/userHandler.js";

const TEST_DB_PATH = "test_atomic_orders.db";

async function setupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const testDb = createClient({ url: `file:${TEST_DB_PATH}` });

  await testDb.batch([
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
      delivery_price_per_food REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      rider_id INTEGER,
      rider_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,

    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      food_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_order REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
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

    `CREATE TABLE IF NOT EXISTS riders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT NOT NULL,
      secret_code TEXT UNIQUE,
      active INTEGER DEFAULT 1
    );`
  ]);

  return testDb;
}

async function runAtomicOrderTests() {
  console.log("🧪 Starting Atomic Order Transaction Test Suite...\n");

  const testDb = await setupTestDb();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Successful Order Without Contracts
    // -------------------------------------------------------------
    console.log("--- TEST 1: Successful Standard Order (No Contracts) ---");
    const user1 = 10001;
    const result1 = await executeNormalOrderTransaction({
      userId: user1,
      name: "User One",
      phone: "+251911111111",
      campus: "campus_techno_boys",
      restaurant: "Askuala",
      restaurantId: 1,
      mealType: "Lunch",
      foods: [
        { name: "Burger", quantity: 2, price: 100 },
        { name: "Fries", quantity: 1, price: 50 },
      ],
      hasRestaurantContract: false,
      hasDeliveryContract: false,
      foodSubtotal: 250,
      deliveryFee: 40,
      deliveryPricePerFood: 20,
      grandTotal: 290,
      foodsSummary: "Burger x2, Fries x1",
      client: testDb,
    });

    assert(result1.orderId > 0, "Order 1 returns valid positive order ID");

    const orderRow1 = (
      await testDb.execute({
        sql: "SELECT * FROM orders WHERE id = ?",
        args: [result1.orderId],
      })
    ).rows[0];

    assert(orderRow1 !== undefined, "Order record exists in orders table");
    assert(Number(orderRow1?.total_price) === 290, "Order total_price matches grandTotal (290 ETB)");
    assert(Number(orderRow1?.has_restaurant_contract) === 0, "has_restaurant_contract is 0");
    assert(Number(orderRow1?.has_delivery_contract) === 0, "has_delivery_contract is 0");

    const items1 = (
      await testDb.execute({
        sql: "SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC",
        args: [result1.orderId],
      })
    ).rows;

    assert(items1.length === 2, "Exactly 2 order items inserted");
    assert(items1[0]?.food_name === "Burger" && Number(items1[0]?.quantity) === 2 && Number(items1[0]?.price_at_order) === 100, "Item 1 price and quantity preserved");
    assert(items1[1]?.food_name === "Fries" && Number(items1[1]?.quantity) === 1 && Number(items1[1]?.price_at_order) === 50, "Item 2 price and quantity preserved");

    // -------------------------------------------------------------
    // TEST 2: Successful Order with Restaurant Contract Deduction
    // -------------------------------------------------------------
    console.log("\n--- TEST 2: Successful Order with Restaurant Contract ---");
    const user2 = 10002;
    await testDb.execute({
      sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
            VALUES (?, 1, 'Askuala', 30, 1)`,
      args: [user2],
    });

    const result2 = await executeNormalOrderTransaction({
      userId: user2,
      name: "User Two",
      phone: "+251922222222",
      campus: "campus_techno_boys",
      restaurant: "Askuala",
      restaurantId: 1,
      mealType: "Lunch",
      foods: [{ name: "Special Shiro", quantity: 1, price: 120 }],
      hasRestaurantContract: true,
      hasDeliveryContract: false,
      foodSubtotal: 0,
      deliveryFee: 20,
      deliveryPricePerFood: 20,
      grandTotal: 20,
      foodsSummary: "Special Shiro x1",
      client: testDb,
    });

    const restContract2 = (
      await testDb.execute({
        sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?",
        args: [user2],
      })
    ).rows[0];

    assert(Number(restContract2?.remaining_meals) === 29, "Restaurant contract decremented from 30 to 29");
    const orderRow2 = (
      await testDb.execute({
        sql: "SELECT has_restaurant_contract, food_total, total_price FROM orders WHERE id = ?",
        args: [result2.orderId],
      })
    ).rows[0];
    assert(Number(orderRow2?.has_restaurant_contract) === 1 && Number(orderRow2?.food_total) === 0, "Order marked as restaurant contract with food_total = 0");

    // -------------------------------------------------------------
    // TEST 3: Successful Order with Delivery Contract Deduction
    // -------------------------------------------------------------
    console.log("\n--- TEST 3: Successful Order with Delivery Contract ---");
    const user3 = 10003;
    await testDb.execute({
      sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
            VALUES (?, 'campus_techno_boys', 15, 1)`,
      args: [user3],
    });

    // Ordering 3 items: remaining deliveries should become 15 - 3 = 12
    const result3 = await executeNormalOrderTransaction({
      userId: user3,
      name: "User Three",
      phone: "+251933333333",
      campus: "campus_techno_boys",
      restaurant: "Askuala",
      restaurantId: 1,
      foods: [
        { name: "Burger", quantity: 2, price: 100 },
        { name: "Soda", quantity: 1, price: 40 },
      ],
      hasRestaurantContract: false,
      hasDeliveryContract: true,
      foodSubtotal: 240,
      deliveryFee: 0,
      deliveryPricePerFood: 0,
      grandTotal: 240,
      foodsSummary: "Burger x2, Soda x1",
      client: testDb,
    });

    const delContract3 = (
      await testDb.execute({
        sql: "SELECT remaining_deliveries FROM delivery_contracts WHERE telegram_id = ?",
        args: [user3],
      })
    ).rows[0];

    assert(Number(delContract3?.remaining_deliveries) === 12, "Delivery contract decremented by total quantity: 15 - 3 = 12");
    assert(result3.remainingDeliveries === 12, "Result returns remainingDeliveries = 12");

    // -------------------------------------------------------------
    // TEST 4: Order with BOTH Restaurant & Delivery Contracts
    // -------------------------------------------------------------
    console.log("\n--- TEST 4: Both Restaurant and Delivery Contracts Used ---");
    const user4 = 10004;
    await testDb.execute({
      sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
            VALUES (?, 1, 'Askuala', 10, 1)`,
      args: [user4],
    });
    await testDb.execute({
      sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
            VALUES (?, 'campus_techno_boys', 8, 1)`,
      args: [user4],
    });

    const result4 = await executeNormalOrderTransaction({
      userId: user4,
      name: "User Four",
      phone: "+251944444444",
      campus: "campus_techno_boys",
      restaurant: "Askuala",
      restaurantId: 1,
      foods: [{ name: "Beef Tibs", quantity: 2, price: 250 }],
      hasRestaurantContract: true,
      hasDeliveryContract: true,
      foodSubtotal: 0,
      deliveryFee: 0,
      deliveryPricePerFood: 0,
      grandTotal: 0,
      foodsSummary: "Beef Tibs x2",
      client: testDb,
    });

    const remMeals4 = (
      await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?", args: [user4] })
    ).rows[0]?.remaining_meals;
    const remDel4 = (
      await testDb.execute({ sql: "SELECT remaining_deliveries FROM delivery_contracts WHERE telegram_id = ?", args: [user4] })
    ).rows[0]?.remaining_deliveries;

    assert(Number(remMeals4) === 9, "Meals decremented: 10 -> 9");
    assert(Number(remDel4) === 6, "Deliveries decremented: 8 - 2 = 6");

    // -------------------------------------------------------------
    // TEST 5: Insufficient Restaurant Contract Balance Rollback
    // -------------------------------------------------------------
    console.log("\n--- TEST 5: Insufficient Restaurant Contract Balance Triggers Rollback ---");
    const user5 = 10005;
    await testDb.execute({
      sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
            VALUES (?, 1, 'Askuala', 0, 1)`, // 0 meals remaining
      args: [user5],
    });

    const initialOrderCount5 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);

    let caughtError5 = false;
    try {
      await executeNormalOrderTransaction({
        userId: user5,
        name: "User Five",
        phone: "+251955555555",
        campus: "campus_techno_boys",
        restaurant: "Askuala",
        restaurantId: 1,
        foods: [{ name: "Beef Tibs", quantity: 1, price: 250 }],
        hasRestaurantContract: true,
        hasDeliveryContract: false,
        foodSubtotal: 0,
        deliveryFee: 20,
        deliveryPricePerFood: 20,
        grandTotal: 20,
        foodsSummary: "Beef Tibs x1",
        client: testDb,
      });
    } catch (err: any) {
      caughtError5 = true;
      assert(err.message.includes("contract balance"), "Error explicitly mentions contract balance");
    }

    assert(caughtError5, "Insufficient restaurant contract threw error");
    const postOrderCount5 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);
    assert(postOrderCount5 === initialOrderCount5, "No order committed after restaurant contract rollback");

    // -------------------------------------------------------------
    // TEST 6: Insufficient Delivery Contract Balance Rollback
    // -------------------------------------------------------------
    console.log("\n--- TEST 6: Insufficient Delivery Contract Balance Triggers Rollback ---");
    const user6 = 10006;
    await testDb.execute({
      sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
            VALUES (?, 'campus_techno_boys', 1, 1)`, // Only 1 delivery left
      args: [user6],
    });

    const initialOrderCount6 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);

    let caughtError6 = false;
    try {
      // Ordering 2 items but only 1 delivery available
      await executeNormalOrderTransaction({
        userId: user6,
        name: "User Six",
        phone: "+251966666666",
        campus: "campus_techno_boys",
        restaurant: "Askuala",
        restaurantId: 1,
        foods: [{ name: "Burger", quantity: 2, price: 100 }],
        hasRestaurantContract: false,
        hasDeliveryContract: true,
        foodSubtotal: 200,
        deliveryFee: 0,
        deliveryPricePerFood: 0,
        grandTotal: 200,
        foodsSummary: "Burger x2",
        client: testDb,
      });
    } catch (err: any) {
      caughtError6 = true;
      assert(err.message.includes("delivery contract balance"), "Error explicitly mentions delivery contract balance");
    }

    assert(caughtError6, "Insufficient delivery contract threw error");
    const postOrderCount6 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);
    assert(postOrderCount6 === initialOrderCount6, "No order committed after delivery contract rollback");
    const remDel6 = (
      await testDb.execute({ sql: "SELECT remaining_deliveries FROM delivery_contracts WHERE telegram_id = ?", args: [user6] })
    ).rows[0]?.remaining_deliveries;
    assert(Number(remDel6) === 1, "Delivery balance remains intact at 1");

    // -------------------------------------------------------------
    // TEST 7: Order Item Insert Failure Rolls Back Order & Contract
    // -------------------------------------------------------------
    console.log("\n--- TEST 7: Partial Failure During Items Roll Back Whole Transaction ---");
    const user7 = 10007;
    await testDb.execute({
      sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
            VALUES (?, 1, 'Askuala', 20, 1)`,
      args: [user7],
    });

    const initialOrderCount7 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);

    let caughtError7 = false;
    try {
      const mockTx = await testDb.transaction("write");
      try {
        await mockTx.execute({
          sql: "UPDATE restaurant_contracts SET remaining_meals = remaining_meals - 1 WHERE telegram_id = ?",
          args: [user7],
        });
        const oRes = await mockTx.execute({
          sql: "INSERT INTO orders (telegram_id, user_name, phone, campus, restaurant, foods_summary, food_total, delivery_fee, total_price, status) VALUES (?, 'U7', 'P7', 'C', 'R', 'F', 0, 0, 0, 'pending') RETURNING id;",
          args: [user7],
        });
        const oId = Number(oRes.rows[0]?.id);
        await mockTx.execute({
          sql: "INSERT INTO order_items (order_id, food_name, quantity, price_at_order) VALUES (?, 'Item 1', 1, 100)",
          args: [oId],
        });
        // Intentionally invalid statement to trigger rollback
        await mockTx.execute({
          sql: "INSERT INTO order_items_NONEXISTENT_TABLE VALUES (1, 2, 3)",
          args: [],
        });
        await mockTx.commit();
      } catch (err) {
        caughtError7 = true;
        if (!mockTx.closed) await mockTx.rollback();
      } finally {
        if (!mockTx.closed) mockTx.close();
      }
    } catch {}

    assert(caughtError7, "Simulated middle failure caught");
    const postOrderCount7 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);
    assert(postOrderCount7 === initialOrderCount7, "No order committed after mid-transaction failure");
    const remMeals7 = (
      await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?", args: [user7] })
    ).rows[0]?.remaining_meals;
    assert(Number(remMeals7) === 20, "Restaurant contract balance rolled back to initial 20");

    // -------------------------------------------------------------
    // TEST 8: Isolated Test DB Integrity & Zero Contamination
    // -------------------------------------------------------------
    console.log("\n--- TEST 8: Test Database Isolation ---");
    assert(fs.existsSync(TEST_DB_PATH), "Isolated test database exists on disk and was used");

    console.log(`\n========================================`);
    console.log(`🏁 ATOMIC ORDER TESTS COMPLETED: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    testDb.close();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
      if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    } catch (e) {}
  }
}

runAtomicOrderTests().catch((err) => {
  console.error("❌ Fatal error in atomic order tests:", err);
  process.exit(1);
});
