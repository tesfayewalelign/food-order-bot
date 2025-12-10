import { Markup } from "telegraf";
import { supabase } from "../config/supabase.js";

export function getMainMenuKeyboard(isAdmin: boolean, isDriver: boolean) {
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
  [
    Markup.button.callback(
      "🏫 Main Girls White House Dorm",
      "campus_main_girls_white_house"
    ),
  ],
  [
    Markup.button.callback(
      "🏫 Main Girls Africa House Dorm",
      "campus_main_girls_africa_house"
    ),
  ],
  [Markup.button.callback("🏫 Techno Boys Dorm", "campus_techno_boys")],
  [Markup.button.callback("🏫 Techno Girls Dorm", "campus_techno_girls")],
  [Markup.button.callback("🏫 Agri Campus", "campus_agri")],
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

    if (error || !restaurants || restaurants.length === 0) {
      return Markup.inlineKeyboard([
        [Markup.button.callback("ℹ️ No restaurants available", "none")],
        [
          Markup.button.callback(
            "➕ Other / Custom Restaurant",
            "custom_restaurant"
          ),
        ],
      ]);
    }

    // Remove duplicates based on ID
    const uniqueRestaurants = Array.from(
      new Map(restaurants.map((r) => [r.id, r])).values()
    );

    const buttons: any[] = [];
    const columns = 3; // 3 buttons per row

    for (let i = 0; i < uniqueRestaurants.length; i += columns) {
      const row: any[] = [];
      for (let j = 0; j < columns; j++) {
        const r = uniqueRestaurants[i + j];
        if (r) row.push(Markup.button.callback(r.name, `restaurant_${r.id}`));
      }
      buttons.push(row);
    }

    // ✅ Add "Custom Restaurant" as the LAST row
    buttons.push([
      Markup.button.callback(
        "➕ Other / Custom Restaurant",
        "custom_restaurant"
      ),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[Restaurant Keyboard] Unexpected error:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("ℹ️ No restaurants available", "none")],
      [
        Markup.button.callback(
          "➕ Other / Custom Restaurant",
          "custom_restaurant"
        ),
      ],
    ]);
  }
}

export async function getFoodKeyboard(
  restaurantId?: string,
  mealType?: string
) {
  try {
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

    // Remove duplicates
    const uniqueFoods = Array.from(
      new Map(foods.map((f) => [f.id, f])).values()
    );

    const buttons: any[] = [];
    for (let i = 0; i < uniqueFoods.length; i += 2) {
      const f1 = uniqueFoods[i];
      const f2 = uniqueFoods[i + 1];

      if (!f1) continue; // skip undefined
      const row = [
        Markup.button.callback(`${f1.name} (${f1.price} ETB)`, `food_${f1.id}`),
      ];

      if (f2)
        row.push(
          Markup.button.callback(
            `${f2.name} (${f2.price} ETB)`,
            `food_${f2.id}`
          )
        );

      buttons.push(row);
    }

    buttons.push([
      Markup.button.callback("✅ Done Selecting Foods", "done_food"),
    ]);

    return Markup.inlineKeyboard(buttons);
  } catch (err) {
    console.error("[Food Keyboard] Unexpected error:", err);
    return Markup.inlineKeyboard([
      [Markup.button.callback("ℹ️ No foods available", "none")],
    ]);
  }
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
const riderOrderKeyboard = (orderId: number) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(`✅ Approve`, `rider_order_approve_${orderId}`),
      Markup.button.callback(`❌ Reject`, `rider_order_reject_${orderId}`),
    ],
  ]);

export async function getUserContract(userId: number) {
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Contract fetch error:", error);
    return null;
  }

  return contract ?? null;
}
