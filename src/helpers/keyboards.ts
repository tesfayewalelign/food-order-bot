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

export const restaurantKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("🍽 Askuala", "restaurant_Askuala"),
    Markup.button.callback("🍽 Fike", "restaurant_Fike"),
  ],
  [
    Markup.button.callback("🍽 Mesi", "restaurant_Mesi"),
    Markup.button.callback("🍽 Pepsi", "restaurant_Pepsi"),
  ],
  [
    Markup.button.callback("🍽 Adonay", "restaurant_Adonay"),
    Markup.button.callback("🍽 Shewit", "restaurant_Shewit"),
  ],
  [
    Markup.button.callback("🍽 AM", "restaurant_AM"),
    Markup.button.callback("🍽 Ahadu", "restaurant_Ahadu"),
  ],
  [Markup.button.callback("🍽 Selam", "restaurant_Selam")],
]);

export const foodKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("🍲 Beyaynet", "food_Yenet"),
    Markup.button.callback("🍲 Pasta be atkilit", "food_Pasta be atkilit"),
  ],
  [
    Markup.button.callback("🍲 Pasta be sgo", "food_Pasta be sgo"),
    Markup.button.callback("🍲 Dnch", "food_Dnch"),
  ],
  [
    Markup.button.callback("🍲 Firfir", "food_Firfir"),
    Markup.button.callback("🍲 Alcha firfir", "food_Alcha firfir"),
  ],
  [
    Markup.button.callback("🍲 Timatim lebleb", "food_Timatim lebleb"),
    Markup.button.callback("🍲 Timatim sils", "food_Timatim sils"),
  ],
  [
    Markup.button.callback("🍲 Enkulal sils", "food_Enkulal sils"),
    Markup.button.callback("🍲 Enkulal firfir", "food_Enkulal firfir"),
  ],
  [Markup.button.callback("✅ Done Selecting Foods", "done_food")],
]);

export const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Confirm Order", "confirm_order")],
  [Markup.button.callback("❌ Cancel", "cancel_order")],
]);

export const deliveryKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🆕 New", "delivery_new")],
  [Markup.button.callback("📃 Contract", "delivery_contract")],
]);
