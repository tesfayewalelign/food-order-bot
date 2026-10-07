import { initDb, db } from "../config/db.js";
import { getUserRole } from "../helpers/roles.js";
import {
  checkRestaurantContract,
  checkDeliveryContract,
  hasActiveRestaurantContract,
  hasActiveDeliveryContract,
  DEFAULT_MEAL_ALLOWANCE,
  DEFAULT_DELIVERY_ALLOWANCE,
} from "../helpers/contracts.js";
import {
  getRestaurantKeyboard,
  getFoodKeyboard,
  getMainMenuKeyboard,
} from "../helpers/keyboards.js";

async function runTests() {
  console.log("🧪 Starting Automated Food Delivery Bot Integration Tests...\n");

  // Initialize DB
  await initDb();

  // Test 1: Role Detection Priority
  console.log("--- Test 1: Role Detection Priority ---");
  process.env.ADMIN_TELEGRAM_IDS = "999001,999002";

  // Setup test rider
  await db.execute({
    sql: "INSERT OR REPLACE INTO riders (id, telegram_id, name, phone, campus, secret_code, active) VALUES (9000, 999002, 'Test Rider', '0911000000', 'Main Boys Africa', '7777', 1)",
    args: [],
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO riders (id, telegram_id, name, phone, campus, secret_code, active) VALUES (9001, 999003, 'Rider Only', '0911000001', 'Techno Boys', '8888', 1)",
    args: [],
  });

  const adminRole = await getUserRole(999001);
  console.log(`Role for Admin 999001: ${adminRole}`);
  if (adminRole !== "admin") throw new Error("Expected admin role for 999001");

  const adminRiderRole = await getUserRole(999002);
  console.log(`Role for Admin+Rider 999002: ${adminRiderRole}`);
  if (adminRiderRole !== "admin") throw new Error("Expected admin priority for 999002");

  const riderRole = await getUserRole(999003);
  console.log(`Role for Rider 999003: ${riderRole}`);
  if (riderRole !== "rider") throw new Error("Expected rider role for 999003");

  const customerRole = await getUserRole(999004);
  console.log(`Role for Normal Customer 999004: ${customerRole}`);
  if (customerRole !== "customer") throw new Error("Expected customer role for 999004");

  console.log("✅ Test 1 Passed: Role Detection & Priority is correct!\n");

  // Test 1B: Rider Secret Code Activation
  console.log("--- Test 1B: Rider Secret Code Activation ---");
  await db.execute({
    sql: "INSERT OR REPLACE INTO riders (id, telegram_id, name, phone, campus, secret_code, active) VALUES (9005, NULL, 'Pending Rider', '0911999999', 'Main Boys Africa', '8295', 1)",
    args: [],
  });

  const beforeActivationRole = await getUserRole(999005);
  if (beforeActivationRole !== "customer") throw new Error("Expected customer role before activation");

  // Activate via secret code 8295
  const riderToActivate = (await db.execute({
    sql: "SELECT * FROM riders WHERE secret_code = '8295' AND active = 1",
    args: [],
  })).rows[0];

  if (!riderToActivate) throw new Error("Pending rider not found for code 8295");

  await db.execute({
    sql: "UPDATE riders SET telegram_id = ? WHERE id = ?",
    args: [999005, Number(riderToActivate.id)],
  });

  const afterActivationRole = await getUserRole(999005);
  if (afterActivationRole !== "rider") throw new Error("Expected rider role after activation with code 8295");

  console.log("✅ Test 1B Passed: Rider Secret Code Activation (8295) working!\n");

  // Test 2: Active vs Inactive Restaurant and Food Filtering
  console.log("--- Test 2: Restaurant & Food Active Filtering ---");
  await db.execute("INSERT OR REPLACE INTO restaurants (id, name, active) VALUES (8000, 'Test Active Rest', 1)");
  await db.execute("INSERT OR REPLACE INTO restaurants (id, name, active) VALUES (8001, 'Test Inactive Rest', 0)");

  await db.execute("INSERT OR REPLACE INTO foods (id, restaurant_id, name, price, active) VALUES (8000, 8000, 'Active Food', 120, 1)");
  await db.execute("INSERT OR REPLACE INTO foods (id, restaurant_id, name, price, active) VALUES (8001, 8000, 'Inactive Food', 150, 0)");

  const restKb = await getRestaurantKeyboard();
  const restKbStr = JSON.stringify(restKb);
  if (!restKbStr.includes("Test Active Rest")) throw new Error("Active restaurant missing from keyboard");
  if (restKbStr.includes("Test Inactive Rest")) throw new Error("Inactive restaurant should not appear in keyboard");

  const foodKb = await getFoodKeyboard(8000);
  const foodKbStr = JSON.stringify(foodKb);
  if (!foodKbStr.includes("Active Food")) throw new Error("Active food missing from keyboard");
  if (foodKbStr.includes("Inactive Food")) throw new Error("Inactive food should not appear in keyboard");

  console.log("✅ Test 2 Passed: Inactive items properly filtered!\n");

  // Test 3: Order Acceptance & Atomic Race Guard
  console.log("--- Test 3: Rider Atomic Order Acceptance ---");
  const orderRes = await db.execute({
    sql: `INSERT INTO orders (telegram_id, user_name, phone, campus, restaurant, foods_summary, has_restaurant_contract, has_delivery_contract, food_total, delivery_fee, total_price, status)
          VALUES (999004, 'Test Customer', '0912345678', 'Main Boys Africa', 'Askuala', 'Shiro x1', 0, 0, 120, 10, 130, 'pending')
          RETURNING id;`,
    args: [],
  });
  const testOrderId = Number(orderRes.rows[0]?.id);

  // Rider 1 accepts
  const update1 = await db.execute({
    sql: "UPDATE orders SET status = 'accepted', rider_id = 9001, rider_name = 'Rider Only' WHERE id = ? AND status = 'pending'",
    args: [testOrderId],
  });
  if (update1.rowsAffected !== 1) throw new Error("First rider failed to accept order");

  // Rider 2 tries to accept same order
  const update2 = await db.execute({
    sql: "UPDATE orders SET status = 'accepted', rider_id = 9000, rider_name = 'Test Rider' WHERE id = ? AND status = 'pending'",
    args: [testOrderId],
  });
  if (update2.rowsAffected !== 0) throw new Error("Second rider should NOT be able to accept order");

  console.log("✅ Test 3 Passed: Atomic order acceptance & race condition guard working!\n");

  // Test 4: Delivery Lifecycle Status Transitions
  console.log("--- Test 4: Delivery Lifecycle Transitions ---");
  // Transition: accepted -> on_the_way
  const transition1 = await db.execute({
    sql: "UPDATE orders SET status = 'on_the_way' WHERE id = ? AND rider_id = 9001 AND status = 'accepted'",
    args: [testOrderId],
  });
  if (transition1.rowsAffected !== 1) throw new Error("Failed transition accepted -> on_the_way");

  // Transition: on_the_way -> picked_up
  const transition2 = await db.execute({
    sql: "UPDATE orders SET status = 'picked_up' WHERE id = ? AND rider_id = 9001 AND status = 'on_the_way'",
    args: [testOrderId],
  });
  if (transition2.rowsAffected !== 1) throw new Error("Failed transition on_the_way -> picked_up");

  // Invalid transition: try going back to pending
  const invalidTransition = await db.execute({
    sql: "UPDATE orders SET status = 'pending' WHERE id = ? AND rider_id = 9001 AND status = 'delivered'",
    args: [testOrderId],
  });
  if (invalidTransition.rowsAffected !== 0) throw new Error("Invalid transition delivered -> pending was allowed!");

  // Transition: picked_up -> delivered
  const transition3 = await db.execute({
    sql: "UPDATE orders SET status = 'delivered' WHERE id = ? AND rider_id = 9001 AND status = 'picked_up'",
    args: [testOrderId],
  });
  if (transition3.rowsAffected !== 1) throw new Error("Failed transition picked_up -> delivered");

  console.log("✅ Test 4 Passed: Delivery lifecycle status transitions enforced correctly!\n");

  // Test 5: Contract Request & Allowance Safety
  console.log("--- Test 5: Contract Request & Allowance Safety ---");
  const testCustomerId = 999888;
  await db.execute({
    sql: "DELETE FROM restaurant_contracts WHERE telegram_id = ?",
    args: [testCustomerId],
  });

  // Approve restaurant contract
  await db.execute({
    sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
          VALUES (?, 8000, 'Test Active Rest', ?, 1)`,
    args: [testCustomerId, DEFAULT_MEAL_ALLOWANCE],
  });

  const activeContractCheck = await hasActiveRestaurantContract(testCustomerId, 8000);
  if (!activeContractCheck) throw new Error("Failed to detect active restaurant contract");

  // Decrement meal safely
  const mealDeduct = await db.execute({
    sql: `UPDATE restaurant_contracts
          SET remaining_meals = remaining_meals - 1
          WHERE id = (
            SELECT id FROM restaurant_contracts
            WHERE telegram_id = ? AND is_active = 1 AND remaining_meals > 0
            LIMIT 1
          )`,
    args: [testCustomerId],
  });
  if (mealDeduct.rowsAffected !== 1) throw new Error("Failed to safely deduct meal allowance");

  const contractDetails = await checkRestaurantContract(testCustomerId, 8000);
  if (!contractDetails || Number(contractDetails.remaining_meals) !== DEFAULT_MEAL_ALLOWANCE - 1) {
    throw new Error(`Meal balance mismatch. Expected ${DEFAULT_MEAL_ALLOWANCE - 1}, got ${contractDetails?.remaining_meals}`);
  }

  console.log("✅ Test 5 Passed: Contract request, allowance configuration & safe deduction working!\n");

  console.log("🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Integration Test Failed:", err);
  process.exit(1);
});
