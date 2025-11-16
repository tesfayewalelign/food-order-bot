import { Markup } from "telegraf";
import { supabase } from "../config/supabase.js";

export function getMainMenuKeyboard(isAdmin: boolean, isDriver: boolean) {
  if (isAdmin) {
    return Markup.keyboard([
      ["📦 View Orders", "➕ Add Restaurant"],
      ["👥 Manage Users", "⚙️ Settings"],
      ["📦 Manage Contracts", "menu_contracts"],
      ["🏠 Main Menu"],
    ]).resize();
  }

  if (isDriver) {
    return Markup.keyboard([
      ["🚗 My Deliveries", "📅 Schedule"],
      ["🏠 Main Menu"],
    ]).resize();
  }

  return Markup.keyboard([
    ["🍔 Order Food", "📦 My Orders"],
    ["⭐ Favorite Orders", "ℹ️ Help"],
    ["🏠 Main Menu"],
  ]).resize();
}

export const campusKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(
      "🏫 Main Boys Whites House Dorm",
      "campus_main_boys_whites_house"
    ),
  ],
  [
    Markup.button.callback(
      "🏫 Main Boys Africa Dorm",
      "campus_main_boys_africa"
    ),
  ],
  [Markup.button.callback("🏫 Main Girls Dorm", "campus_main_girls")],
  [Markup.button.callback("🏫 Techno Boys Dorm", "campus_techno_boys")],
  [Markup.button.callback("🏫 Techno Girls Dorm", "campus_techno_girls")],
]);

export const deliveryKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🆕 New", "delivery_new")],
  [Markup.button.callback("📃 Contract", "delivery_contract")],
]);

export const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Confirm Order", "confirm_order")],
  [Markup.button.callback("❌ Cancel", "cancel_order")],
]);

export async function getRestaurantKeyboard() {
  try {
    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("id, name")
      .order("id");

    if (error) {
      console.error("[Restaurant Keyboard] Supabase error:", error.message);
      return Markup.inlineKeyboard([
        [Markup.button.callback("ℹ️ No restaurants available", "none")],
      ]);
    }

    if (!restaurants || restaurants.length === 0) {
      return Markup.inlineKeyboard([
        [Markup.button.callback("ℹ️ No restaurants available", "none")],
      ]);
    }

    const buttons = [];
    for (let i = 0; i < restaurants.length; i += 2) {
      const r1 = restaurants[i];
      const r2 = restaurants[i + 1];
      if (!r1) continue;
      const row = [Markup.button.callback(r1.name, `restaurant_${r1.id}`)];
      if (r2) row.push(Markup.button.callback(r2.name, `restaurant_${r2.id}`));
      buttons.push(row);
    }

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[Restaurant Keyboard] Unexpected error:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("ℹ️ No restaurants available", "none")],
    ]);
  }
}

export async function getFoodKeyboard(restaurantId: number) {
  const { data: foods, error } = await supabase
    .from("foods")
    .select("id, name, price")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (error || !foods || foods.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("ℹ️ No foods available", "none")],
    ]);
  }

  const rows = foods.map((f) => [
    Markup.button.callback(`${f.name} (${f.price} ETB)`, `food_${f.id}`),
  ]);

  rows.push([Markup.button.callback("✅ Done Selecting Foods", "done_food")]);
  return Markup.inlineKeyboard(rows);
}

export async function getUserFoodKeyboard(restaurantId: string) {
  const { data: foods, error } = await supabase
    .from("foods")
    .select("id, name, price")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (error || !foods) return { reply_markup: { inline_keyboard: [] } };

  const buttons = foods.map((f) => [
    Markup.button.callback(`${f.name} - ${f.price} ETB`, `food_${f.id}`),
  ]);

  buttons.push([Markup.button.callback("✅ Done", "done_food")]);
  return { reply_markup: { inline_keyboard: buttons } };
}

export async function getAdminFoodKeyboard(restaurantId: string) {
  const { data: foods, error } = await supabase
    .from("foods")
    .select("id, name, price")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (error || !foods) return { reply_markup: { inline_keyboard: [] } };

  const buttons = foods.map((f) => [
    Markup.button.callback(`${f.name} - ${f.price} ETB`, `food_${f.id}`),
  ]);

  buttons.push([
    Markup.button.callback("➕ Add New Food", `admin_add_food_${restaurantId}`),
    Markup.button.callback("⬅️ Back", "admin_back_restaurant"),
  ]);

  return { reply_markup: { inline_keyboard: buttons } };
}
