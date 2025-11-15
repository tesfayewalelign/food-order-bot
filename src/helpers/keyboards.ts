// src/helpers/keyboards.ts
import { Markup } from "telegraf";
import { supabase } from "../config/supabase.js";

// ---------------- MAIN MENU ----------------
export function getMainMenuKeyboard(isAdmin: boolean, isDriver: boolean) {
  if (isAdmin) {
    return Markup.keyboard([
      ["📦 View Orders", "➕ Add Restaurant"],
      ["👥 Manage Users", "⚙️ Settings"],
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

// ---------------- CAMPUS ----------------
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

// ---------------- DELIVERY TYPE ----------------
export const deliveryKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🆕 New", "delivery_new")],
  [Markup.button.callback("📃 Contract", "delivery_contract")],
]);

// ---------------- CONFIRM ORDER ----------------
export const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Confirm Order", "confirm_order")],
  [Markup.button.callback("❌ Cancel", "cancel_order")],
]);

// ---------------- DYNAMIC RESTAURANT KEYBOARD ----------------
export async function restaurantKeyboard() {
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("*");

  if (error || !restaurants || restaurants.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("No restaurants found", "none")],
    ]);
  }

  // Create inline buttons in rows of 2
  const buttons = [];
  for (let i = 0; i < restaurants.length; i += 2) {
    const row = [];
    row.push(
      Markup.button.callback(
        `🍽 ${restaurants[i].name}`,
        `restaurant_${restaurants[i].name}`
      )
    );
    if (restaurants[i + 1])
      row.push(
        Markup.button.callback(
          `🍽 ${restaurants[i + 1].name}`,
          `restaurant_${restaurants[i + 1].name}`
        )
      );
    buttons.push(row);
  }

  return Markup.inlineKeyboard(buttons);
}

// ---------------- DYNAMIC FOOD KEYBOARD ----------------
export async function foodKeyboard(restaurantName: string) {
  const { data: foods, error } = await supabase
    .from("foods")
    .select("*")
    .eq("restaurant_id", await getRestaurantIdByName(restaurantName));

  if (error || !foods || foods.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("No foods found", "none")],
    ]);
  }

  const buttons = [];
  for (let i = 0; i < foods.length; i += 2) {
    const row = [];
    row.push(
      Markup.button.callback(`🍲 ${foods[i].name}`, `food_${foods[i].name}`)
    );
    if (foods[i + 1])
      row.push(
        Markup.button.callback(
          `🍲 ${foods[i + 1].name}`,
          `food_${foods[i + 1].name}`
        )
      );
    buttons.push(row);
  }

  // Add Done button at the end
  buttons.push([
    Markup.button.callback("✅ Done Selecting Foods", "done_food"),
  ]);
  return Markup.inlineKeyboard(buttons);
}

// ---------------- HELPER ----------------
async function getRestaurantIdByName(name: string) {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("name", name)
    .single();
  if (error || !data) return null;
  return data.id;
}
