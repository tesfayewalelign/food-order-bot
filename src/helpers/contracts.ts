import { db } from "../config/db.js";

export const DEFAULT_MEAL_ALLOWANCE = 30;
export const DEFAULT_DELIVERY_ALLOWANCE = 30;

export async function checkRestaurantContract(
  userId: number,
  restaurantId?: string | number,
  restaurantName?: string
) {
  try {
    let sql =
      "SELECT * FROM restaurant_contracts WHERE telegram_id = ? AND is_active = 1 AND remaining_meals > 0";
    let args: any[] = [userId];
    if (restaurantId) {
      sql += " AND (restaurant_id = ? OR restaurant_name = ?)";
      args.push(Number(restaurantId), restaurantName || "");
    }
    const result = await db.execute({ sql, args });
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    console.error("checkRestaurantContract error:", err);
    return null;
  }
}

export async function checkDeliveryContract(userId: number) {
  try {
    const result = await db.execute({
      sql: "SELECT * FROM delivery_contracts WHERE telegram_id = ? AND is_active = 1 AND remaining_deliveries > 0",
      args: [userId],
    });
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    console.error("checkDeliveryContract error:", err);
    return null;
  }
}

export async function getUserContract(userId: number) {
  return checkDeliveryContract(userId);
}

export async function hasActiveRestaurantContract(userId: number, restaurantId?: number | null): Promise<boolean> {
  try {
    let sql = "SELECT id FROM restaurant_contracts WHERE telegram_id = ? AND is_active = 1";
    let args: any[] = [userId];
    if (restaurantId) {
      sql += " AND restaurant_id = ?";
      args.push(restaurantId);
    }
    const result = await db.execute({ sql, args });
    return result.rows.length > 0;
  } catch (err) {
    console.error("hasActiveRestaurantContract error:", err);
    return false;
  }
}

export async function hasActiveDeliveryContract(userId: number): Promise<boolean> {
  try {
    const result = await db.execute({
      sql: "SELECT id FROM delivery_contracts WHERE telegram_id = ? AND is_active = 1",
      args: [userId],
    });
    return result.rows.length > 0;
  } catch (err) {
    console.error("hasActiveDeliveryContract error:", err);
    return false;
  }
}
