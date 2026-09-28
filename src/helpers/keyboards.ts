import { Markup } from "telegraf";
import { db } from "../config/db.js";

export function getMainMenuKeyboard(isAdmin: boolean, isDriver: boolean) {
  if (isDriver) {
    return Markup.keyboard([
      ["📦 My Deliveries"],
      ["📅 Schedule"],
      ["🏠 Main Menu"],
    ]).resize();
  }

  return Markup.keyboard([
    ["🍽️ Order Food", "📦 My Orders"],
    ["⭐ Special Order", "❓ Help"],
  ]).resize();
}

export function getHelpMenuKeyboard() {
  return Markup.keyboard([
    ["👤 My Profile", "📞 Contact Us"],
    ["💬 Complaint", "🏠 Main Menu"],
  ]).resize();
}

export const riderMenuKeyboard = Markup.keyboard([
  ["📦 My Deliveries"],
  ["📅 Schedule"],
  ["🏠 Main Menu"],
]).resize();

export const campusKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(
      "🏫 Main Boys Whites House",
      "campus_main_boys_whites_house"
    ),
  ],
  [
    Markup.button.callback(
      "🏫 Main Boys Africa",
      "campus_main_boys_africa"
    ),
  ],
  [
    Markup.button.callback(
      "🏫 Main Girls White House",
      "campus_main_girls_white_house"
    ),
  ],
  [
    Markup.button.callback(
      "🏫 Main Girls Africa House",
      "campus_main_girls_africa_house"
    ),
  ],
  [Markup.button.callback("🏫 Techno Boys Diaspora", "campus_techno_boys")],
  [Markup.button.callback("🏫 Techno Girls", "campus_techno_girls")],
  [Markup.button.callback("🏫 Agri Campus", "campus_agri")],
]);

export const mealTypeKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🥗 Lunch", "meal_lunch")],
  [Markup.button.callback("🌙 Dinner", "meal_dinner")],
  [Markup.button.callback("🔙 Back to Restaurants", "back_to_restaurants")],
]);

export const restaurantContractKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Yes, I am a contract user", "rest_contract_yes")],
  [Markup.button.callback("❌ No, I am not a contract user", "rest_contract_no")],
  [Markup.button.callback("🔙 Back to Restaurants", "back_to_restaurants")],
]);

export const deliveryContractKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Yes, I am a contract user", "del_contract_yes")],
  [Markup.button.callback("❌ No, I am not a contract user", "del_contract_no")],
]);

export const quantityKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("1", "qty_1"),
    Markup.button.callback("2", "qty_2"),
    Markup.button.callback("3", "qty_3"),
    Markup.button.callback("4", "qty_4"),
    Markup.button.callback("5", "qty_5"),
  ],
  [Markup.button.callback("➕ More", "qty_more")],
]);

export const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Confirm Order", "confirm_order")],
  [Markup.button.callback("❌ Cancel", "cancel_order")],
]);

export async function getRestaurantKeyboard() {
  try {
    const result = await db.execute("SELECT id, name FROM restaurants ORDER BY name ASC");
    const restaurants = result.rows;

    const buttons: any[] = [];
    if (restaurants.length > 0) {
      for (let i = 0; i < restaurants.length; i += 2) {
        const row: any[] = [];
        const r1 = restaurants[i];
        const r2 = restaurants[i + 1];
        if (r1) row.push(Markup.button.callback(String(r1.name), `restaurant_${r1.id}`));
        if (r2) row.push(Markup.button.callback(String(r2.name), `restaurant_${r2.id}`));
        buttons.push(row);
      }
    }

    buttons.push([
      Markup.button.callback("➕ Other Restaurant", "custom_restaurant"),
    ]);
    buttons.push([
      Markup.button.callback("🔙 Back to Campus", "back_to_campus"),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[Restaurant Keyboard] Unexpected error:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("➕ Other Restaurant", "custom_restaurant")],
      [Markup.button.callback("🔙 Back to Campus", "back_to_campus")],
    ]);
  }
}

export async function getFoodKeyboard(restaurantId?: string | number) {
  try {
    let sql = "SELECT id, name, price FROM foods ORDER BY name ASC";
    let args: any[] = [];
    if (restaurantId) {
      sql = "SELECT id, name, price FROM foods WHERE restaurant_id = ? ORDER BY name ASC";
      args = [restaurantId];
    }
    const result = await db.execute({ sql, args });
    const foods = result.rows;

    const buttons: any[] = [];
    if (foods.length > 0) {
      for (const f of foods) {
        buttons.push([
          Markup.button.callback(`${f.name} — ${f.price} ETB`, `food_${f.id}`),
        ]);
      }
    } else {
      buttons.push([Markup.button.callback("ℹ️ No listed items (Type custom food)", "custom_food")]);
    }

    buttons.push([
      Markup.button.callback("➕ Custom Food Item", "custom_food"),
      Markup.button.callback("✅ Done Selecting Foods", "done_food"),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[Food Keyboard] Unexpected error:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ Done Selecting Foods", "done_food")],
    ]);
  }
}
