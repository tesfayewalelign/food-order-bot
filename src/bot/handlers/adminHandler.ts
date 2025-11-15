// src/bot/handlers/adminHandler.ts
import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

// ---------------- HELPERS ----------------

// Type guard for text messages
function isTextMessage(
  ctx: Context
): ctx is Context & { message: { text: string } } {
  return (
    !!ctx.message &&
    "text" in ctx.message &&
    typeof ctx.message.text === "string"
  );
}

// ---------------- DYNAMIC KEYBOARDS ----------------

export async function getRestaurantKeyboard() {
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("*")
    .order("id");

  if (!restaurants || restaurants.length === 0)
    return Markup.inlineKeyboard([]);

  const buttons = restaurants.map((r) =>
    Markup.button.callback(`🍽 ${r.name}`, `foods_restaurant_${r.id}`)
  );

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = [buttons[i], buttons[i + 1]].filter(
      (btn): btn is ReturnType<typeof Markup.button.callback> => !!btn
    );
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
}

export async function getFoodKeyboard(restaurantId: number) {
  const { data: foods } = await supabase
    .from("foods")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("id");

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  if (foods && foods.length > 0) {
    for (const f of foods) {
      rows.push([
        Markup.button.callback(
          `✏️ ${f.name} (${f.price} ETB)`,
          `edit_food_${f.id}`
        ),
        Markup.button.callback(`🗑 ${f.name}`, `delete_food_${f.id}`),
      ]);
    }
  }

  // Add "Add Food" and "Back" buttons
  rows.push([
    Markup.button.callback("➕ Add New Food", `add_food_${restaurantId}`),
  ]);
  rows.push([Markup.button.callback("🔙 Back", "menu_foods")]);

  return Markup.inlineKeyboard(rows);
}

// ---------------- ADMIN HANDLER ----------------

export function setupAdminHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  // -------- /admin command --------
  bot.command("admin", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      await ctx.reply("🚫 You are not authorized.");
      return;
    }

    await ctx.reply(
      `👋 Welcome Admin ${ctx.from?.first_name}!`,
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Manage Riders", "menu_riders")],
        [Markup.button.callback("🍽 Manage Restaurants", "menu_restaurants")],
        [Markup.button.callback("🍔 Manage Foods", "menu_foods")],
        [Markup.button.callback("📋 Manage Orders", "menu_orders")],
      ])
    );
  });

  // ---------------- FOODS MANAGEMENT ----------------
  bot.action("menu_foods", async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = await getRestaurantKeyboard();
    await ctx.editMessageText(
      "🍔 Select a restaurant to manage its foods:",
      keyboard
    );
  });

  // Select a restaurant
  bot.action(/foods_restaurant_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const restaurantId = Number(ctx.match[1]);

    // Store selected restaurant in session
    if (!ctx.session) ctx.session = {};
    ctx.session.selectedRestaurantId = restaurantId;

    const keyboard = await getFoodKeyboard(restaurantId);
    await ctx.editMessageText("🍔 Foods in this restaurant:", keyboard);
  });

  // Add new food button
  bot.action(/add_food_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const restaurantId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.selectedRestaurantId = restaurantId;

    await ctx.editMessageText(
      `Send command to add food:\n/add_food "Food Name" Price\nExample:\n/add_food "Shiro" 70`
    );
  });

  // Add food command
  bot.command("add_food", async (ctx) => {
    if (!isTextMessage(ctx)) return;

    const match = ctx.message.text
      .trim()
      .match(/^\/add_food\s+"([^"]+)"\s+(\d+)$/);
    if (!match)
      return ctx.reply('⚠️ Wrong format. Example: /add_food "Shiro" 70');

    const [, name, price] = match;

    const restaurantId = ctx.session?.selectedRestaurantId;
    if (!restaurantId) return ctx.reply("⚠️ Please select a restaurant first.");

    const { error } = await supabase
      .from("foods")
      .insert([{ name, price: Number(price), restaurant_id: restaurantId }]);

    if (error) return ctx.reply("❌ Failed to add food.");
    await ctx.reply(`✅ Food "${name}" added with price ${price} ETB!`);
  });

  // Edit food button
  bot.action(/edit_food_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const foodId = Number(ctx.match[1]);
    await ctx.editMessageText(
      `Send command to edit food:\n/edit_food ${foodId} "New Name" NewPrice\nExample:\n/edit_food ${foodId} "Cheeseburger" 60`
    );
  });

  // Edit food command
  bot.command("edit_food", async (ctx) => {
    if (!isTextMessage(ctx)) return;

    const match = ctx.message.text
      .trim()
      .match(/^\/edit_food\s+(\d+)\s+"([^"]+)"\s+(\d+)$/);
    if (!match)
      return ctx.reply(
        '⚠️ Wrong format. Example: /edit_food 1 "Cheeseburger" 60'
      );

    const [, foodId, name, price] = match;

    const { error } = await supabase
      .from("foods")
      .update({ name, price: Number(price) })
      .eq("id", Number(foodId));

    if (error) return ctx.reply("❌ Failed to update food.");
    await ctx.reply(`✅ Food updated to "${name}" with price ${price} ETB.`);
  });

  // Delete food button
  bot.action(/delete_food_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const foodId = Number(ctx.match[1]);

    const { error } = await supabase.from("foods").delete().eq("id", foodId);
    if (error) return ctx.reply("❌ Failed to delete food.");
    await ctx.reply("🗑 Food deleted successfully.");
  });
}
