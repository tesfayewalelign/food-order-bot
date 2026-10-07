import { initDb, db } from "../config/db.js";
import { getSpecialOrderSettings, calculateSpecialDeliveryFee, updateSpecialOrderSettings } from "../helpers/specialOrderSettings.js";

async function runTests() {
  console.log("🧪 Starting Special Order Automated Test Suite...\n");

  await initDb();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(` ✅ PASS: ${description}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${description}`);
      failed++;
    }
  }

  // --- TEST F: Delivery Calculation Helper ---
  console.log("\n--- TEST F: Delivery Calculation ---");
  const fee1 = calculateSpecialDeliveryFee(4, 50, 20);
  assert(fee1 === 130, "Delivery fee for 4 km with min 50 & 20/km should be 130 ETB");
  const fee2 = calculateSpecialDeliveryFee(0, 50, 20);
  assert(fee2 === 50, "Delivery fee for 0 km with min 50 should be 50 ETB");

  // --- TEST A: Known restaurant and known price ---
  console.log("\n--- TEST A: Known Restaurant & Known Price ---");
  const custA_id = 999001;
  const foodSubtotalA = 80;
  const distanceA = 4;
  const settingsA = await getSpecialOrderSettings();
  const delFeeA = calculateSpecialDeliveryFee(distanceA, settingsA.minDeliveryFee, settingsA.pricePerKm);
  const grandTotalA = foodSubtotalA + delFeeA;

  const resA = await db.execute({
    sql: `INSERT INTO special_orders (
      telegram_id, user_name, phone, campus, restaurant_name, restaurant_location,
      status, food_subtotal, delivery_distance, minimum_delivery_fee, price_per_km,
      delivery_fee, total_price
    ) VALUES (?, 'Abebe', '0912345678', 'campus_techno_boys', 'Mountain Restaurant', 'Piassa',
      'submitted', ?, ?, ?, ?, ?, ?)`,
    args: [custA_id, foodSubtotalA, distanceA, settingsA.minDeliveryFee, settingsA.pricePerKm, delFeeA, grandTotalA],
  });

  const orderIdA = Number(resA.lastInsertRowid || resA.rows[0]?.id);
  assert(orderIdA > 0, "Special Order A created in DB");

  await db.execute({
    sql: "INSERT INTO special_order_items (special_order_id, item_name, quantity, customer_price, final_unit_price, subtotal) VALUES (?, 'Burger', 1, 80, 80, 80)",
    args: [orderIdA],
  });

  // Admin confirms
  const adminConfirmA = await db.execute({
    sql: "UPDATE special_orders SET status = 'admin_confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'",
    args: [orderIdA],
  });
  assert(adminConfirmA.rowsAffected === 1, "Admin confirmed Order A");

  // Customer confirms
  const custConfirmA = await db.execute({
    sql: "UPDATE special_orders SET status = 'ready_for_delivery', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'admin_confirmed'",
    args: [orderIdA],
  });
  assert(custConfirmA.rowsAffected === 1, "Customer confirmed Order A -> status ready_for_delivery");

  assert(grandTotalA === 210, `Grand total A is ${grandTotalA} ETB (Expected: 210 ETB)`);

  // --- TEST B: Customer does not know price ---
  console.log("\n--- TEST B: Customer Unknown Price -> Admin Sets Price ---");
  const resB = await db.execute({
    sql: `INSERT INTO special_orders (
      telegram_id, user_name, phone, campus, restaurant_name, restaurant_location,
      status, food_subtotal, delivery_distance, minimum_delivery_fee, price_per_km, delivery_fee, total_price
    ) VALUES (?, 'Kebede', '0911000000', 'campus_agri', 'Burger House', 'Trufat',
      'submitted', 0, 0, 50, 20, 0, 0)`,
    args: [999002],
  });
  const orderIdB = Number(resB.lastInsertRowid || resB.rows[0]?.id);

  const itemResB = await db.execute({
    sql: "INSERT INTO special_order_items (special_order_id, item_name, quantity, customer_price, admin_price, final_unit_price, subtotal) VALUES (?, 'Special Pizza', 1, NULL, NULL, NULL, NULL)",
    args: [orderIdB],
  });
  const itemIdB = Number(itemResB.lastInsertRowid || itemResB.rows[0]?.id);

  // Admin enters missing price = 150 ETB
  const adminSetPriceB = 150;
  await db.execute({
    sql: "UPDATE special_order_items SET admin_price = ?, final_unit_price = ?, subtotal = ? WHERE id = ?",
    args: [adminSetPriceB, adminSetPriceB, adminSetPriceB * 1, itemIdB],
  });

  // Admin sets distance = 2 km
  const distB = 2;
  const delFeeB = calculateSpecialDeliveryFee(distB, 50, 20); // 50 + 40 = 90
  const totalB = adminSetPriceB + delFeeB; // 150 + 90 = 240

  await db.execute({
    sql: "UPDATE special_orders SET food_subtotal = ?, delivery_distance = ?, delivery_fee = ?, total_price = ? WHERE id = ?",
    args: [adminSetPriceB, distB, delFeeB, totalB, orderIdB],
  });

  const checkB = await db.execute({ sql: "SELECT * FROM special_orders WHERE id = ?", args: [orderIdB] });
  assert(Number(checkB.rows[0]?.total_price) === 240, "Order B grand total calculated correctly as 240 ETB");

  // --- TEST C: Multiple Items Preservation ---
  console.log("\n--- TEST C: Multiple Items ---");
  const resC = await db.execute({
    sql: "INSERT INTO special_orders (telegram_id, user_name, phone, campus, restaurant_name, restaurant_location, status, food_subtotal, delivery_fee, total_price) VALUES (?, 'Chala', '0922000000', 'campus_techno_girls', 'Pizza House', 'Gibi Fit Lefit', 'submitted', 370, 70, 440)",
    args: [999003],
  });
  const orderIdC = Number(resC.lastInsertRowid || resC.rows[0]?.id);

  await db.batch([
    { sql: "INSERT INTO special_order_items (special_order_id, item_name, quantity, final_unit_price, subtotal) VALUES (?, 'Burger', 2, 80, 160)", args: [orderIdC] },
    { sql: "INSERT INTO special_order_items (special_order_id, item_name, quantity, final_unit_price, subtotal) VALUES (?, 'Pizza', 1, 150, 150)", args: [orderIdC] },
    { sql: "INSERT INTO special_order_items (special_order_id, item_name, quantity, final_unit_price, subtotal) VALUES (?, 'Juice', 2, 30, 60)", args: [orderIdC] },
  ]);

  const itemsC = await db.execute({ sql: "SELECT * FROM special_order_items WHERE special_order_id = ?", args: [orderIdC] });
  assert(itemsC.rows.length === 3, "Order C preserved all 3 items");

  // --- TEST D: Customer types custom restaurant ---
  console.log("\n--- TEST D: Custom Typed Restaurant ---");
  const resD = await db.execute({
    sql: "INSERT INTO special_orders (telegram_id, user_name, phone, campus, restaurant_name, restaurant_location, status) VALUES (?, 'Selam', '0933000000', 'campus_agri', 'New Custom Cafe', 'Near Main Gate', 'submitted')",
    args: [999004],
  });
  const orderIdD = Number(resD.lastInsertRowid || resD.rows[0]?.id);
  const checkD = await db.execute({ sql: "SELECT restaurant_name FROM special_orders WHERE id = ?", args: [orderIdD] });
  assert(String(checkD.rows[0]?.restaurant_name) === "New Custom Cafe", "Custom restaurant name saved and retrieved correctly");

  // --- TEST E: Admin Managed Restaurant ---
  console.log("\n--- TEST E: Admin Managed Special Restaurant ---");
  const specRests = await db.execute("SELECT * FROM special_restaurants WHERE name = 'Mountain Restaurant'");
  assert(specRests.rows.length > 0, "Admin-managed special restaurant 'Mountain Restaurant' exists in DB");

  // --- TEST G: Customer Cancellation ---
  console.log("\n--- TEST G: Customer Cancellation ---");
  const resG = await db.execute({
    sql: "INSERT INTO special_orders (telegram_id, user_name, phone, campus, restaurant_name, restaurant_location, status) VALUES (?, 'Dawit', '0944000000', 'campus_techno_boys', 'Mountain Restaurant', 'Piassa', 'admin_confirmed')",
    args: [999005],
  });
  const orderIdG = Number(resG.lastInsertRowid || resG.rows[0]?.id);

  const cancelG = await db.execute({
    sql: "UPDATE special_orders SET status = 'customer_cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'admin_confirmed'",
    args: [orderIdG],
  });
  assert(cancelG.rowsAffected === 1, "Order G status updated to customer_cancelled");

  // --- TEST H: Rider Race Condition (Atomic Acceptance) ---
  console.log("\n--- TEST H: Rider Atomic Acceptance Guard ---");
  const resH = await db.execute({
    sql: "INSERT INTO special_orders (telegram_id, user_name, phone, campus, restaurant_name, restaurant_location, status, total_price) VALUES (?, 'Tigist', '0955000000', 'campus_techno_boys', 'Burger House', 'Piassa', 'ready_for_delivery', 300)",
    args: [999006],
  });
  const orderIdH = Number(resH.lastInsertRowid || resH.rows[0]?.id);

  // Rider 1 accepts
  const rider1Accept = await db.execute({
    sql: "UPDATE special_orders SET status = 'accepted', rider_id = 101, rider_name = 'Rider 1', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ready_for_delivery'",
    args: [orderIdH],
  });
  assert(rider1Accept.rowsAffected === 1, "Rider 1 successfully accepts Special Order H");

  // Rider 2 attempts to accept
  const rider2Accept = await db.execute({
    sql: "UPDATE special_orders SET status = 'accepted', rider_id = 102, rider_name = 'Rider 2', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ready_for_delivery'",
    args: [orderIdH],
  });
  assert(rider2Accept.rowsAffected === 0, "Rider 2 acceptance rejected (0 rows affected)");

  console.log(`\n📊 TEST SUMMARY: Passed ${passed}, Failed ${failed}`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 ALL SPECIAL ORDER TESTS PASSED SUCCESSFULLY!");
  }
}

runTests().catch((err) => {
  console.error("❌ Test suite fatal error:", err);
  process.exit(1);
});
