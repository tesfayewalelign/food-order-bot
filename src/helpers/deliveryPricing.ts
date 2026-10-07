import { db } from "../config/db.js";

export interface DeliveryPriceResult {
  pricePerFood: number;
  isRestaurantOverride: boolean;
  source: "restaurant_override" | "campus_default";
}

export interface CampusPriceItem {
  id: number;
  campus: string;
  pricePerFood: number;
  active: boolean;
}

export interface RestaurantPriceItem {
  id: number;
  restaurantId: number;
  restaurantName: string;
  campus: string;
  pricePerFood: number;
  active: boolean;
}

/**
 * Gets the applicable delivery price per food for a given campus and optional restaurant.
 * Priority 1 — Restaurant + Campus specific price (if active)
 * Priority 2 — Campus default price (if active)
 * Priority 3 — null (if no configured price exists)
 */
export async function getApplicableDeliveryPrice(
  campusKey?: string,
  restaurantId?: number | string | null
): Promise<DeliveryPriceResult | null> {
  if (!campusKey) return null;

  const rawCampus = String(campusKey).trim();
  const restId = restaurantId ? Number(restaurantId) : null;

  try {
    // 1. Exact Match: Priority 1 - Restaurant + Campus Override
    if (restId && !isNaN(restId) && restId > 0) {
      const restRes = await db.execute({
        sql: `SELECT price_per_food FROM delivery_pricing
              WHERE campus = ? AND restaurant_id = ? AND active = 1
              LIMIT 1`,
        args: [rawCampus, restId],
      });
      if (restRes.rows.length > 0 && restRes.rows[0]) {
        return {
          pricePerFood: Number(restRes.rows[0].price_per_food),
          isRestaurantOverride: true,
          source: "restaurant_override",
        };
      }
    }

    // 2. Exact Match: Priority 2 - Campus Default Price
    const campusRes = await db.execute({
      sql: `SELECT price_per_food FROM delivery_pricing
            WHERE campus = ? AND (restaurant_id IS NULL OR restaurant_id = 0) AND active = 1
            LIMIT 1`,
      args: [rawCampus],
    });
    if (campusRes.rows.length > 0 && campusRes.rows[0]) {
      return {
        pricePerFood: Number(campusRes.rows[0].price_per_food),
        isRestaurantOverride: false,
        source: "campus_default",
      };
    }

    // Fallback: Normalized string matching to handle formatted vs raw campus strings
    const allPrices = await db.execute({
      sql: `SELECT id, campus, restaurant_id, price_per_food FROM delivery_pricing WHERE active = 1`,
      args: [],
    });

    const cleanNorm = rawCampus.replace(/^campus_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Priority 1 Fallback (Normalized)
    if (restId && !isNaN(restId) && restId > 0) {
      const match = allPrices.rows.find((r: any) => {
        if (!r.restaurant_id || Number(r.restaurant_id) !== restId) return false;
        const rNorm = String(r.campus).replace(/^campus_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return rNorm === cleanNorm || rNorm.includes(cleanNorm) || cleanNorm.includes(rNorm);
      });
      if (match) {
        return {
          pricePerFood: Number(match.price_per_food),
          isRestaurantOverride: true,
          source: "restaurant_override",
        };
      }
    }

    // Priority 2 Fallback (Normalized)
    const campusMatch = allPrices.rows.find((r: any) => {
      if (r.restaurant_id && Number(r.restaurant_id) > 0) return false;
      const rNorm = String(r.campus).replace(/^campus_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return rNorm === cleanNorm || rNorm.includes(cleanNorm) || cleanNorm.includes(rNorm);
    });

    if (campusMatch) {
      return {
        pricePerFood: Number(campusMatch.price_per_food),
        isRestaurantOverride: false,
        source: "campus_default",
      };
    }

    return null;
  } catch (err) {
    console.error("Error fetching applicable delivery price:", err);
    return null;
  }
}

/**
 * Sets or updates campus default delivery price per food.
 */
export async function setCampusDeliveryPrice(campusKey: string, pricePerFood: number): Promise<void> {
  const existing = await db.execute({
    sql: `SELECT id FROM delivery_pricing WHERE campus = ? AND (restaurant_id IS NULL OR restaurant_id = 0)`,
    args: [campusKey],
  });

  if (existing.rows.length > 0 && existing.rows[0]) {
    await db.execute({
      sql: `UPDATE delivery_pricing SET price_per_food = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [pricePerFood, Number(existing.rows[0].id)],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food, active) VALUES (?, NULL, ?, 1)`,
      args: [campusKey, pricePerFood],
    });
  }
}

/**
 * Sets or updates a restaurant-specific campus delivery price per food.
 */
export async function setRestaurantDeliveryPrice(
  restaurantId: number,
  campusKey: string,
  pricePerFood: number
): Promise<void> {
  const existing = await db.execute({
    sql: `SELECT id FROM delivery_pricing WHERE campus = ? AND restaurant_id = ?`,
    args: [campusKey, restaurantId],
  });

  if (existing.rows.length > 0 && existing.rows[0]) {
    await db.execute({
      sql: `UPDATE delivery_pricing SET price_per_food = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [pricePerFood, Number(existing.rows[0].id)],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO delivery_pricing (campus, restaurant_id, price_per_food, active) VALUES (?, ?, ?, 1)`,
      args: [campusKey, restaurantId, pricePerFood],
    });
  }
}

/**
 * Gets all configured campus default delivery prices.
 */
export async function getCampusDeliveryPrices(): Promise<CampusPriceItem[]> {
  const res = await db.execute({
    sql: `SELECT id, campus, price_per_food, active FROM delivery_pricing
          WHERE (restaurant_id IS NULL OR restaurant_id = 0)
          ORDER BY campus ASC`,
    args: [],
  });

  return res.rows.map((r: any) => ({
    id: Number(r.id),
    campus: String(r.campus),
    pricePerFood: Number(r.price_per_food),
    active: Number(r.active) === 1,
  }));
}

/**
 * Gets all configured restaurant-specific delivery price overrides.
 */
export async function getRestaurantDeliveryPrices(): Promise<RestaurantPriceItem[]> {
  const res = await db.execute({
    sql: `SELECT dp.id, dp.restaurant_id, r.name as restaurant_name, dp.campus, dp.price_per_food, dp.active
          FROM delivery_pricing dp
          JOIN restaurants r ON dp.restaurant_id = r.id
          WHERE dp.restaurant_id IS NOT NULL AND dp.restaurant_id != 0
          ORDER BY r.name ASC, dp.campus ASC`,
    args: [],
  });

  return res.rows.map((r: any) => ({
    id: Number(r.id),
    restaurantId: Number(r.restaurant_id),
    restaurantName: String(r.restaurant_name),
    campus: String(r.campus),
    pricePerFood: Number(r.price_per_food),
    active: Number(r.active) === 1,
  }));
}

/**
 * Deletes a delivery price entry by ID.
 */
export async function deleteDeliveryPrice(id: number): Promise<void> {
  await db.execute({
    sql: `DELETE FROM delivery_pricing WHERE id = ?`,
    args: [id],
  });
}
