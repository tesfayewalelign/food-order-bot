// src/bot/handlers/adminHandler.ts
import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

function generateSecretCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isTextMessage(
  ctx: Context
): ctx is Context & { message: { text: string } } {
  return (
    !!ctx.message &&
    "text" in ctx.message &&
    typeof ctx.message.text === "string"
  );
}

export function setupAdminHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  // ================= Admin Main Menu =================
  bot.command("admin", async (ctx: Context) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      await ctx.reply("🚫 You are not authorized.");
      return;
    }

    await ctx.reply(
      "⚡ Admin Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Manage Riders", "menu_riders")],
        [Markup.button.callback("🍽 Manage Restaurants", "menu_restaurants")],
        [Markup.button.callback("🍔 Manage Foods", "menu_foods")],
        [Markup.button.callback("📋 View Orders", "menu_orders")],
      ])
    );
  });

  bot.action("menu_riders", async (ctx) => {
    await ctx.editMessageText(
      "👤 Riders Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ Add Rider", "add_rider_menu")],
        [Markup.button.callback("📋 List Riders", "list_riders")],
        [Markup.button.callback("🔙 Back", "admin_back")],
      ])
    );
  });

  bot.action("add_rider_menu", async (ctx) => {
    await ctx.editMessageText(
      'To add a rider, send:\n/add_rider Name Phone "Campus"\nExample:\n/add_rider Tesfaye 0968119992 "Techno Girls Dorm"'
    );
  });

  bot.command("add_rider", async (ctx: Context) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      await ctx.reply("🚫 Not authorized.");
      return;
    }

    if (!isTextMessage(ctx)) {
      await ctx.reply("⚠️ Send text only.");
      return;
    }

    const text = ctx.message.text.trim();

    const match = text.match(/^\/add_rider\s+(\S+)\s+(\S+)\s+"([^"]+)"$/);
    if (!match) {
      await ctx.reply(
        `⚠️ Wrong format.\nUse:\n/add_rider Tesfaye 0968119992 "Techno Girls Dorm"`
      );
      return;
    }

    const [, name, phone, campus] = match;
    const secret_code = generateSecretCode();

    const { error } = await supabase
      .from("riders")
      .insert([
        { name, phone, campus, secret_code, telegram_id: null, active: true },
      ]);

    if (error) {
      console.error("[add_rider]", error);
      await ctx.reply("❌ Failed to add rider. Check DB.");
      return;
    }

    await ctx.reply(
      `✅ Rider added successfully!\n👤 Name: ${name}\n📞 Phone: ${phone}\n🏠 Campus: ${campus}\n` +
        `📌 Secret Code: ${secret_code}\nThe rider must start the bot and enter this code.`
    );
  });

  bot.action("list_riders", async (ctx) => {
    const { data: riders, error } = await supabase
      .from("riders")
      .select("*")
      .order("id");

    if (error || !riders) {
      await ctx.editMessageText("⚠️ Failed to fetch riders.");
      return;
    }

    if (riders.length === 0) {
      await ctx.editMessageText("📭 No riders found.");
      return;
    }

    let text = "👤 Riders List:\n";
    for (const r of riders) {
      text += `\nID: ${r.id} | ${r.name} | ${r.phone} | ${r.campus} | Active: ${
        r.active ? "✅" : "❌"
      }`;
    }
    await ctx.editMessageText(text);
  });

  bot.action("menu_restaurants", async (ctx) => {
    await ctx.editMessageText(
      "🍽 Restaurants Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ Add Restaurant", "add_restaurant")],
        [Markup.button.callback("📋 List Restaurants", "list_restaurants")],
        [Markup.button.callback("🔙 Back", "admin_back")],
      ])
    );
  });

  bot.action("add_restaurant", async (ctx) => {
    await ctx.editMessageText(
      'Send command:\n/add_restaurant "Restaurant Name"'
    );
  });

  bot.command("add_restaurant", async (ctx: Context) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    if (!isTextMessage(ctx)) return;

    const text = ctx.message.text.trim();
    const match = text.match(/^\/add_restaurant\s+"([^"]+)"$/);
    if (!match) {
      await ctx.reply('⚠️ Wrong format.\nUse:\n/add_restaurant "Fike"');
      return;
    }

    const [, name] = match;
    const { error } = await supabase.from("restaurants").insert([{ name }]);
    if (error) return ctx.reply("❌ Failed to add restaurant.");

    await ctx.reply(`✅ Restaurant "${name}" added successfully!`);
  });

  bot.action("list_restaurants", async (ctx) => {
    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("*");

    if (error || !restaurants)
      return ctx.editMessageText("⚠️ Failed to fetch restaurants.");

    let text = "🍽 Restaurants:\n";
    for (const r of restaurants) text += `\nID: ${r.id} | ${r.name}`;
    await ctx.editMessageText(text);
  });

  // ================= Manage Foods =================
  bot.action("menu_foods", async (ctx) => {
    await ctx.editMessageText(
      "🍔 Foods Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ Add Food", "add_food")],
        [Markup.button.callback("📋 List Foods", "list_foods")],
        [Markup.button.callback("🔙 Back", "admin_back")],
      ])
    );
  });

  bot.action("add_food", async (ctx) => {
    await ctx.editMessageText(
      'Send command:\n/add_food "Food Name" RestaurantID Price\nExample:\n/add_food "Burger" 1 50'
    );
  });

  bot.command("add_food", async (ctx: Context) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    if (!isTextMessage(ctx)) return;

    const text = ctx.message.text.trim();
    const match = text.match(/^\/add_food\s+"([^"]+)"\s+(\d+)\s+(\d+)$/);
    if (!match) {
      await ctx.reply('⚠️ Wrong format.\nUse:\n/add_food "Burger" 1 50');
      return;
    }

    const [, name, restaurant_id, price] = match;
    const { error } = await supabase
      .from("foods")
      .insert([
        { name, restaurant_id: Number(restaurant_id), price: Number(price) },
      ]);
    if (error) return ctx.reply("❌ Failed to add food.");

    await ctx.reply(`✅ Food "${name}" added successfully!`);
  });

  bot.action("list_foods", async (ctx) => {
    const { data: foods, error } = await supabase
      .from("foods")
      .select("id, name, restaurant_id, price");

    if (error || !foods)
      return ctx.editMessageText("⚠️ Failed to fetch foods.");

    let text = "🍔 Foods List:\n";
    for (const f of foods)
      text += `\nID: ${f.id} | ${f.name} | RestaurantID: ${f.restaurant_id} | Price: ${f.price} ETB`;
    await ctx.editMessageText(text);
  });

  bot.action("admin_back", async (ctx) => {
    await ctx.deleteMessage();
    ctx.telegram.sendMessage(
      ctx.from!.id,
      "🔙 Back to main menu. Send /admin to open menu again."
    );
  });
}
