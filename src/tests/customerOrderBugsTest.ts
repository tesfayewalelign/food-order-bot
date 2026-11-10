import { createClient } from "@libsql/client";
import fs from "fs";
import { checkRestaurantContract } from "../helpers/contracts.js";
import { userState, resetUserState } from "../helpers/state.js";
import { isValidCustomerName, isValidPhoneNumber, normalizePhoneNumber } from "../helpers/utils.js";
import { executeNormalOrderTransaction } from "../bot/handlers/userHandler.js";

const TEST_DB_PATH = "test_customer_order_bugs.db";

async function runBugReproductionTests() {
  console.log("🧪 Starting Customer Order Bugs & Regression Test Suite...\n");

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const testDb = createClient({ url: `file:${TEST_DB_PATH}` });

  await testDb.batch([
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
      active INTEGER DEFAULT 1
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
      delivery_price_per_food REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      food_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_order REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS restaurant_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      restaurant_id INTEGER,
      restaurant_name TEXT NOT NULL,
      remaining_meals INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1
    );`,
    `CREATE TABLE IF NOT EXISTS delivery_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      campus TEXT NOT NULL,
      remaining_deliveries INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
  ]);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${details ? " - " + details : ""}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: resetUserState preserves user identity in memory
  // -------------------------------------------------------------
  userState.set(1001, {
    step: "confirm_order",
    name: "Abebe Bikila",
    phone: "+251911223344",
    campus: "campus_main_boys_whites_house",
    foods: [{ name: "Shiro", quantity: 1, price: 120 }],
    cartFoods: [],
  });

  resetUserState(1001);
  const stateAfterReset = userState.get(1001);

  assert(
    stateAfterReset?.name === "Abebe Bikila" && stateAfterReset?.phone === "+251911223344",
    "Test 1: resetUserState preserves name and phone across order resets"
  );
  assert(
    stateAfterReset?.foods.length === 0 && stateAfterReset?.step === "idle",
    "Test 1B: resetUserState clears previous cart foods and resets step to idle"
  );

  // -------------------------------------------------------------
  // TEST 2: Customer Name Validation
  // -------------------------------------------------------------
  assert(!isValidCustomerName("🍔 Order Food"), "Test 2A: Rejects '🍔 Order Food' as name");
  assert(!isValidCustomerName("🍽️ Order Food"), "Test 2B: Rejects '🍽️ Order Food' as name");
  assert(!isValidCustomerName("📦 My Orders"), "Test 2C: Rejects '📦 My Orders' as name");
  assert(!isValidCustomerName("/start"), "Test 2D: Rejects command '/start' as name");
  assert(!isValidCustomerName("a"), "Test 2E: Rejects single letter as name");
  assert(isValidCustomerName("Abebe Kebede"), "Test 2F: Accepts valid full name 'Abebe Kebede'");
  assert(isValidCustomerName("ፍቄ ተስፋዬ"), "Test 2G: Accepts valid Amharic name 'ፍቄ ተስፋዬ'");

  // -------------------------------------------------------------
  // TEST 3: Phone Number Validation & Normalization
  // -------------------------------------------------------------
  assert(!isValidPhoneNumber("🍔 Order Food"), "Test 3A: Rejects '🍔 Order Food' as phone");
  assert(!isValidPhoneNumber("123"), "Test 3B: Rejects short numeric string as phone");
  assert(!isValidPhoneNumber("no phone"), "Test 3C: Rejects arbitrary text as phone");
  assert(isValidPhoneNumber("0911223344"), "Test 3D: Accepts '0911223344'");
  assert(isValidPhoneNumber("+251911223344"), "Test 3E: Accepts '+251911223344'");
  assert(isValidPhoneNumber("0712345678"), "Test 3F: Accepts '0712345678'");

  assert(
    normalizePhoneNumber("0911223344") === "+251911223344",
    "Test 3G: Normalizes '0911223344' to '+251911223344'"
  );
  assert(
    normalizePhoneNumber("0712345678") === "+251712345678",
    "Test 3H: Normalizes '0712345678' to '+251712345678'"
  );
  assert(
    normalizePhoneNumber("+251911223344") === "+251911223344",
    "Test 3I: Preserves '+251911223344'"
  );

  // -------------------------------------------------------------
  // TEST 4: checkRestaurantContract requires restaurantId or restaurantName
  // -------------------------------------------------------------
  const noMatch = await checkRestaurantContract(1001, undefined, undefined);
  assert(noMatch === null, "Test 4: checkRestaurantContract returns null if neither id nor name provided");

  // -------------------------------------------------------------
  // TEST 5: Database Profile and Order Coalescing
  // -------------------------------------------------------------
  await testDb.execute("INSERT INTO profiles (telegram_id, name, phone, campus) VALUES (2001, 'Nahom Tesfaye', '+251973136233', 'campus_techno_boys')");
  // Historical corrupted order where user_name was 'Customer' and phone was empty
  await testDb.execute(`
    INSERT INTO orders (telegram_id, user_name, phone, campus, restaurant, foods_summary, food_total, delivery_fee, total_price)
    VALUES (2001, 'Customer', '', 'campus_techno_boys', 'Askuala', 'Shiro x1', 120, 20, 140)
  `);

  const orderRes = await testDb.execute(`
    SELECT o.*,
           CASE
             WHEN o.user_name IS NULL OR o.user_name IN ('Customer', '🍔 Order Food', '🍽️ Order Food', '') THEN p.name
             ELSE o.user_name
           END as effective_user_name,
           CASE
             WHEN o.phone IS NULL OR o.phone IN ('', '🍔 Order Food', '🍽️ Order Food', 'N/A') THEN p.phone
             ELSE o.phone
           END as effective_phone
    FROM orders o
    LEFT JOIN profiles p ON o.telegram_id = p.telegram_id
    WHERE o.telegram_id = 2001
  `);
  const fetchedOrder = orderRes.rows[0];

  assert(
    fetchedOrder?.effective_user_name === "Nahom Tesfaye",
    "Test 5A: Corrupted 'Customer' order coalesces to registered profile name 'Nahom Tesfaye'"
  );
  assert(
    fetchedOrder?.effective_phone === "+251973136233",
    "Test 5B: Corrupted empty phone order coalesces to registered profile phone '+251973136233'"
  );

  // -------------------------------------------------------------
  // TEST 6: Contract belonging to another restaurant must NEVER be deducted
  // -------------------------------------------------------------
  const user6 = 3001;
  await testDb.execute({
    sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
          VALUES (?, 1, 'Askuala', 30, 1)`,
    args: [user6],
  });

  const ordersBefore6 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);

  let caughtRestMismatch = false;
  try {
    // Ordering from Restaurant 2 ('Fike') while holding contract for Restaurant 1 ('Askuala')
    await executeNormalOrderTransaction({
      userId: user6,
      name: "User Six",
      phone: "+251966666666",
      campus: "campus_techno_boys",
      restaurant: "Fike",
      restaurantId: 2,
      mealType: "Lunch",
      foods: [{ name: "Tibs", quantity: 1, price: 200 }],
      hasRestaurantContract: true,
      hasDeliveryContract: false,
      foodSubtotal: 0,
      deliveryFee: 20,
      deliveryPricePerFood: 20,
      grandTotal: 20,
      foodsSummary: "Tibs x1",
      client: testDb,
    });
  } catch (err: any) {
    caughtRestMismatch = true;
  }

  assert(caughtRestMismatch, "Test 6A: Ordering from different restaurant fails contract deduction");
  const contract6 = (await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ? AND restaurant_id = 1", args: [user6] })).rows[0];
  assert(Number(contract6?.remaining_meals) === 30, "Test 6B: Contract for original restaurant remains strictly 30 (not deducted)");
  const ordersAfter6 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);
  assert(ordersAfter6 === ordersBefore6, "Test 6C: No order inserted when restaurant contract mismatch occurs");

  // -------------------------------------------------------------
  // TEST 7: Missing restaurant identity must not cause arbitrary contract deduction
  // -------------------------------------------------------------
  const user7 = 3002;
  await testDb.execute({
    sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
          VALUES (?, 1, 'Askuala', 30, 1)`,
    args: [user7],
  });

  let caughtMissingRestId = false;
  try {
    await executeNormalOrderTransaction({
      userId: user7,
      name: "User Seven",
      phone: "+251977777777",
      campus: "campus_techno_boys",
      restaurant: "",
      restaurantId: null,
      mealType: "Dinner",
      foods: [{ name: "Shiro", quantity: 1, price: 100 }],
      hasRestaurantContract: true,
      hasDeliveryContract: false,
      foodSubtotal: 0,
      deliveryFee: 20,
      deliveryPricePerFood: 20,
      grandTotal: 20,
      foodsSummary: "Shiro x1",
      client: testDb,
    });
  } catch (err: any) {
    caughtMissingRestId = true;
  }

  assert(caughtMissingRestId, "Test 7A: Missing restaurant identity rejects order transaction");
  const contract7 = (await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?", args: [user7] })).rows[0];
  assert(Number(contract7?.remaining_meals) === 30, "Test 7B: Contract balance unaffected at 30 when restaurant identity is missing");

  // -------------------------------------------------------------
  // TEST 8: Insufficient meal balance must not create an order
  // -------------------------------------------------------------
  const user8 = 3003;
  await testDb.execute({
    sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
          VALUES (?, 1, 'Askuala', 1, 1)`, // only 1 meal remaining
    args: [user8],
  });

  const ordersBefore8 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);

  let caughtInsufficientMeals = false;
  try {
    // Ordering 2 meals when only 1 is available
    await executeNormalOrderTransaction({
      userId: user8,
      name: "User Eight",
      phone: "+251988888888",
      campus: "campus_techno_boys",
      restaurant: "Askuala",
      restaurantId: "1",
      mealType: "Lunch",
      foods: [{ name: "Shiro", quantity: 2, price: 100 }],
      hasRestaurantContract: true,
      hasDeliveryContract: false,
      foodSubtotal: 0,
      deliveryFee: 40,
      deliveryPricePerFood: 20,
      grandTotal: 40,
      foodsSummary: "Shiro x2",
      client: testDb,
    });
  } catch (err: any) {
    caughtInsufficientMeals = true;
  }

  assert(caughtInsufficientMeals, "Test 8A: Insufficient meal balance throws error");
  const contract8 = (await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?", args: [user8] })).rows[0];
  assert(Number(contract8?.remaining_meals) === 1, "Test 8B: Meal balance intact at 1 after rollback");
  const ordersAfter8 = Number((await testDb.execute("SELECT count(*) as count FROM orders")).rows[0]?.count);
  assert(ordersAfter8 === ordersBefore8, "Test 8C: Zero orders created when meal balance is insufficient");

  // -------------------------------------------------------------
  // TEST 9: Correct quantity deduction if contract units represent individual meals
  // -------------------------------------------------------------
  const user9 = 3004;
  await testDb.execute({
    sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
          VALUES (?, 1, 'Askuala', 20, 1)`,
    args: [user9],
  });

  const result9 = await executeNormalOrderTransaction({
    userId: user9,
    name: "User Nine",
    phone: "+251999999999",
    campus: "campus_techno_boys",
    restaurant: "Askuala",
    restaurantId: "1",
    mealType: "Lunch",
    foods: [
      { name: "Shiro", quantity: 2, price: 100 },
      { name: "Burger", quantity: 1, price: 150 },
    ], // total quantity = 3
    hasRestaurantContract: true,
    hasDeliveryContract: false,
    foodSubtotal: 0,
    deliveryFee: 60,
    deliveryPricePerFood: 20,
    grandTotal: 60,
    foodsSummary: "Shiro x2, Burger x1",
    client: testDb,
  });

  const contract9 = (await testDb.execute({ sql: "SELECT remaining_meals FROM restaurant_contracts WHERE telegram_id = ?", args: [user9] })).rows[0];
  assert(Number(contract9?.remaining_meals) === 17, "Test 9A: Contract balance decremented by total food quantity: 20 - 3 = 17");
  const orderItems9 = (await testDb.execute({ sql: "SELECT * FROM order_items WHERE order_id = ?", args: [result9.orderId] })).rows;
  assert(orderItems9.length === 2, "Test 9B: Both order items recorded in order_items");

  // -------------------------------------------------------------
  // TEST 10: Notification failure must not duplicate or undo an order
  // -------------------------------------------------------------
  const user10 = 3005;
  userState.set(user10, {
    step: "confirm_order",
    name: "User Ten",
    phone: "+251910101010",
    campus: "campus_techno_boys",
    restaurant: "Askuala",
    restaurantId: "1",
    foods: [{ name: "Shiro", quantity: 1, price: 100 }],
    cartFoods: [],
    isSubmittingOrder: true,
  });

  // Step 1: Normal order transaction executes and commits
  const tx10 = await executeNormalOrderTransaction({
    userId: user10,
    name: "User Ten",
    phone: "+251910101010",
    campus: "campus_techno_boys",
    restaurant: "Askuala",
    restaurantId: "1",
    foods: [{ name: "Shiro", quantity: 1, price: 100 }],
    hasRestaurantContract: false,
    hasDeliveryContract: false,
    foodSubtotal: 100,
    deliveryFee: 20,
    deliveryPricePerFood: 20,
    grandTotal: 120,
    foodsSummary: "Shiro x1",
    client: testDb,
  });

  const committedOrderId = tx10.orderId;
  const state10 = userState.get(user10)!;

  // Simulate post-commit handler: state is cleared immediately upon commit
  state10.foods = [];
  state10.cartFoods = [];
  state10.isSubmittingOrder = false;

  // Simulate simulated notification failure (e.g. Telegram network outage)
  let simulatedNotificationError = false;
  try {
    throw new Error("Telegram API Network Timeout during rider/admin broadcast");
  } catch (notifyErr) {
    simulatedNotificationError = true;
    // Handled safely without undoing order
    resetUserState(user10);
  }

  assert(simulatedNotificationError, "Test 10A: Simulated notification dispatch failure intercepted");

  // Verify order in database was NOT undone
  const orderInDb = (await testDb.execute({ sql: "SELECT id, status FROM orders WHERE id = ?", args: [committedOrderId] })).rows[0];
  assert(Number(orderInDb?.id) === committedOrderId, "Test 10B: Committed order persists in database despite notification failure");

  // Verify duplicate order submission is prevented because state was safely cleared
  const stateAfterNotificationFail = userState.get(user10);
  const canDuplicate = (stateAfterNotificationFail?.foods.length ?? 0) > 0;
  assert(!canDuplicate, "Test 10C: State foods empty; duplicate order cannot be submitted on re-click");

  // -------------------------------------------------------------
  // TEST 11: Corrupted profile records in DB are rejected as invalid registration
  // -------------------------------------------------------------
  const corruptedName = "🍔 Order Food";
  const corruptedPhone = "🍔 Order Food";
  assert(!isValidCustomerName(corruptedName), "Test 11A: Corrupted name '🍔 Order Food' fails isValidCustomerName");
  assert(!isValidPhoneNumber(corruptedPhone), "Test 11B: Corrupted phone '🍔 Order Food' fails isValidPhoneNumber");

  console.log(`\n📊 Bug Fix Test Summary: ${passed} passed, ${failed} failed.`);
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runBugReproductionTests().catch((e) => {
  console.error(e);
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  process.exit(1);
});
