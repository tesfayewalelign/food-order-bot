import { Markup } from "telegraf";
import { db } from "../config/db.js";

export async function getSpecialRestaurantKeyboard() {
  try {
    const result = await db.execute("SELECT id, name FROM special_restaurants WHERE (active IS NULL OR active = 1) ORDER BY name ASC");
    const restaurants = result.rows;

    const buttons: any[] = [];
    if (restaurants.length > 0) {
      for (let i = 0; i < restaurants.length; i += 2) {
        const row: any[] = [];
        const r1 = restaurants[i];
        const r2 = restaurants[i + 1];
        if (r1) row.push(Markup.button.callback(`🏪 ${r1.name}`, `so_rest_${r1.id}`));
        if (r2) row.push(Markup.button.callback(`🏪 ${r2.name}`, `so_rest_${r2.id}`));
        buttons.push(row);
      }
    }

    buttons.push([
      Markup.button.callback("✍️ Type Restaurant Name", "so_rest_custom"),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[SpecialOrderKeyboards] Error loading special restaurants:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("✍️ Type Restaurant Name", "so_rest_custom")],
    ]);
  }
}

export async function getSpecialLocationKeyboard(specialRestaurantId?: number | null) {
  try {
    let locations: any[] = [];
    if (specialRestaurantId) {
      const res = await db.execute({
        sql: "SELECT location_name FROM special_restaurant_locations WHERE special_restaurant_id = ? AND (active IS NULL OR active = 1) ORDER BY location_name ASC",
        args: [specialRestaurantId],
      });
      locations = res.rows;
    }

    const defaultLocations = [
      "Gibi Fit Lefit",
      "Menahariya",
      "Piassa",
      "Trufat",
      "Hayk",
      "Mobil Atote",
    ];

    const locNames = locations.length > 0
      ? locations.map((l) => String(l.location_name))
      : defaultLocations;

    const buttons: any[] = [];
    for (let i = 0; i < locNames.length; i += 2) {
      const row: any[] = [];
      const l1 = locNames[i];
      const l2 = locNames[i + 1];
      if (l1) row.push(Markup.button.callback(`📍 ${l1}`, `so_loc_${l1}`));
      if (l2) row.push(Markup.button.callback(`📍 ${l2}`, `so_loc_${l2}`));
      buttons.push(row);
    }

    buttons.push([
      Markup.button.callback("✍️ Type Location", "so_loc_custom"),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[SpecialOrderKeyboards] Error loading locations:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("✍️ Type Location", "so_loc_custom")],
    ]);
  }
}

export const specialOrderItemsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("➕ Add Another Item", "so_add_item")],
  [Markup.button.callback("✅ Done", "so_done_items")],
]);

export const specialOrderPriceKnowledgeKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Yes, I know the price", "so_price_yes")],
  [Markup.button.callback("❓ I don't know the price", "so_price_no")],
]);

export const specialOrderReviewKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("📤 Submit Request", "so_submit_request")],
  [Markup.button.callback("❌ Cancel", "so_cancel_request")],
]);

export function getSpecialOrderCustomerFinalConfirmKeyboard(orderId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm Order", `so_customer_confirm_${orderId}`)],
    [Markup.button.callback("❌ Cancel Order", `so_customer_cancel_${orderId}`)],
  ]);
}

export function getSpecialOrderRiderKeyboard(orderId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Accept Order", `accept_so_order_${orderId}`),
      Markup.button.callback("❌ Reject", `reject_so_order_${orderId}`),
    ],
  ]);
}
