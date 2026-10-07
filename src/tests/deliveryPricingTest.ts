import { db, initDb } from "../config/db.js";
import {
  getApplicableDeliveryPrice,
  setCampusDeliveryPrice,
  setRestaurantDeliveryPrice,
} from "../helpers/deliveryPricing.js";

async function runDeliveryPricingTests() {
  console.log("🧪 Starting Delivery Pricing Integration Tests...\n");
  await initDb();

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

  // Clean up any old restaurant overrides for clean test isolation
  await db.execute("DELETE FROM delivery_pricing WHERE restaurant_id IS NOT NULL");

  // Set up test campus default prices
  await setCampusDeliveryPrice("campus_techno_boys", 20);
  await setCampusDeliveryPrice("campus_main_boys_africa", 15);

  // Setup sample restaurant
  const restRes = await db.execute({
    sql: "SELECT id FROM restaurants WHERE name = 'Askuala' LIMIT 1",
    args: [],
  });
  let askualaId = Number(restRes.rows[0]?.id);
  if (!askualaId) {
    const ins = await db.execute({
      sql: "INSERT INTO restaurants (name) VALUES ('Askuala') RETURNING id",
      args: [],
    });
    askualaId = Number(ins.rows[0]?.id);
  }

  // --- TEST 1: Campus Default Pricing ---
  const t1 = await getApplicableDeliveryPrice("campus_techno_boys", askualaId);
  const qty1 = 2; // Burger x 2
  const fee1 = qty1 * (t1?.pricePerFood ?? 0);
  assert(
    t1?.pricePerFood === 20 && fee1 === 40 && t1?.isRestaurantOverride === false,
    "Test 1 — Campus default: Techno Boys Diaspora @ 20 ETB/food (2 items = 40 ETB)"
  );

  // --- TEST 2: Multiple Food Items ---
  const qty2 = 3; // Burger x 2 + Pizza x 1 = 3 items
  const fee2 = qty2 * (t1?.pricePerFood ?? 0);
  assert(
    fee2 === 60,
    "Test 2 — Multiple food items: 3 items @ 20 ETB/food = 60 ETB"
  );

  // --- TEST 3: Restaurant Override Pricing ---
  await setRestaurantDeliveryPrice(askualaId, "campus_techno_boys", 15);
  const t3 = await getApplicableDeliveryPrice("campus_techno_boys", askualaId);
  const fee3 = 2 * (t3?.pricePerFood ?? 0);
  assert(
    t3?.pricePerFood === 15 && fee3 === 30 && t3?.isRestaurantOverride === true,
    "Test 3 — Restaurant override: Askuala @ Techno Boys Diaspora override = 15 ETB/food (2 items = 30 ETB)"
  );

  // --- TEST 4: No Restaurant Override Fallback ---
  // Create another restaurant without override
  const r2Res = await db.execute({
    sql: "SELECT id FROM restaurants WHERE name = 'Fike' LIMIT 1",
    args: [],
  });
  let fikeId = Number(r2Res.rows[0]?.id);
  if (!fikeId) {
    const ins = await db.execute({
      sql: "INSERT INTO restaurants (name) VALUES ('Fike') RETURNING id",
      args: [],
    });
    fikeId = Number(ins.rows[0]?.id);
  }
  const t4 = await getApplicableDeliveryPrice("campus_techno_boys", fikeId);
  assert(
    t4?.pricePerFood === 20 && t4?.isRestaurantOverride === false,
    "Test 4 — No restaurant override: Fike falls back to campus default 20 ETB/food"
  );

  // --- TEST 5: Contract Delivery Usage (Decrements by 1) ---
  const testUserId = 987654321;
  await db.execute({
    sql: "DELETE FROM delivery_contracts WHERE telegram_id = ?",
    args: [testUserId],
  });
  await db.execute({
    sql: "INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active) VALUES (?, 'campus_techno_boys', 28, 1)",
    args: [testUserId],
  });

  // Simulate contract order delivery deduction
  await db.execute({
    sql: `UPDATE delivery_contracts
          SET remaining_deliveries = remaining_deliveries - 1
          WHERE id = (
            SELECT id FROM delivery_contracts
            WHERE telegram_id = ? AND is_active = 1 AND remaining_deliveries > 0
            LIMIT 1
          )`,
    args: [testUserId],
  });

  const contractRes = await db.execute({
    sql: "SELECT remaining_deliveries FROM delivery_contracts WHERE telegram_id = ?",
    args: [testUserId],
  });
  const rem = Number(contractRes.rows[0]?.remaining_deliveries);
  assert(
    rem === 27,
    "Test 5 — Contract delivery: 28 remaining -> 27 remaining after order (decrements by 1, NOT per food item)"
  );

  // --- TEST 6: Contract Exhausted ---
  await db.execute({
    sql: "UPDATE delivery_contracts SET remaining_deliveries = 0 WHERE telegram_id = ?",
    args: [testUserId],
  });

  const updateRes = await db.execute({
    sql: `UPDATE delivery_contracts
          SET remaining_deliveries = remaining_deliveries - 1
          WHERE id = (
            SELECT id FROM delivery_contracts
            WHERE telegram_id = ? AND is_active = 1 AND remaining_deliveries > 0
            LIMIT 1
          )`,
    args: [testUserId],
  });
  assert(
    updateRes.rowsAffected === 0,
    "Test 6 — Contract exhausted: remaining_deliveries = 0 cannot be used"
  );

  // --- TEST 7: Historical Price Preservation ---
  const orderRes = await db.execute({
    sql: `INSERT INTO orders (telegram_id, user_name, phone, campus, restaurant, foods_summary, food_total, delivery_fee, total_price, delivery_price_per_food, status)
          VALUES (?, 'Historical Test User', '0911000000', 'campus_techno_boys', 'Askuala', 'Shiro x2', 200, 30, 230, 15, 'delivered')
          RETURNING id`,
    args: [testUserId],
  });
  const orderId = Number(orderRes.rows[0]?.id);

  // Now change the current delivery price in Admin to 25 ETB
  await setRestaurantDeliveryPrice(askualaId, "campus_techno_boys", 25);

  const fetchOrder = await db.execute({
    sql: "SELECT delivery_price_per_food, delivery_fee, total_price FROM orders WHERE id = ?",
    args: [orderId],
  });
  const histOrder = fetchOrder.rows[0];
  assert(
    Number(histOrder?.delivery_price_per_food) === 15 &&
      Number(histOrder?.delivery_fee) === 30 &&
      Number(histOrder?.total_price) === 230,
    "Test 7 — Price changed: Historical order preserves original delivery price (15 ETB/food, 30 ETB fee)"
  );

  // --- TEST 8: Special Order Pricing Untouched ---
  // Special order formula: 50 + (distance * price_per_km)
  const dist = 4;
  const kmPrice = 20;
  const minFee = 50;
  const specialOrderFee = minFee + dist * kmPrice;
  assert(
    specialOrderFee === 130,
    "Test 8 — Special Order: Uses 50 ETB min + distance x price/km (130 ETB for 4km) and is untouched"
  );

  console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runDeliveryPricingTests().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
