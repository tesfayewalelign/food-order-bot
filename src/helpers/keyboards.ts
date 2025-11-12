import { Markup } from "telegraf";
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
    ["ℹ️ Help", "🏠 Main Menu"],
  ]).resize();
}

export const campusKeyboard = Markup.keyboard([
  ["🏫 Main Boys Whites House Dorm", "🏫 Main Girls Dorm"],
  ["Main Boys Africa Dorm"],
  ["🏫 Techno Boys Dorm", "🏫 Techno Girls Dorm"],
]).resize();

export const restaurantKeyboard = Markup.keyboard([
  ["🍽 Askuala", "🍽 Fike"],
  ["🍽 Mesi", "🍽 Pepsi"],
  ["🍽 Adonay", "🍽 Shewit"],
  ["🍽 AM", "🍽 Ahadu"],
  ["🍽 Selam"],
]).resize();

export const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Confirm Order", "confirm_order")],
  [Markup.button.callback("❌ Cancel", "cancel_order")],
]);
