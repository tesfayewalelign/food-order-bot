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

async function getRestaurantIdByName(name: string): Promise<number> {
  const { data } = await supabase
    .from("restaurants")
    .select("id")
    .eq("name", name)
    .single();
  return data?.id || 0;
}

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
    const row = [buttons[i], buttons[i + 1]].filter(Boolean) as any;
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

  if (!foods || foods.length === 0) {
    rows.push([
      Markup.button.callback("➕ Add New Food", `add_food_${restaurantId}`),
    ]);
  } else {
    foods.forEach((f) => {
      rows.push([
        Markup.button.callback(
          `✏️ ${f.name} (${f.price} ETB)`,
          `edit_food_${f.id}`
        ),
        Markup.button.callback(`🗑 ${f.name}`, `delete_food_${f.id}`),
      ]);
    });
    rows.push([
      Markup.button.callback("➕ Add New Food", `add_food_${restaurantId}`),
    ]);
  }

  rows.push([Markup.button.callback("🔙 Back", "menu_foods")]);
  return Markup.inlineKeyboard(rows);
}

interface AdminState {
  action?:
    | "add_restaurant"
    | "add_food"
    | "add_rider"
    | "edit_food"
    | "set_contract";
  restaurantId?: number;
  foodId?: string;
  tempData?: any;
}

const adminStates = new Map<number, AdminState>();

export function setupAdminHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  bot.command("admin", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId))
      return ctx.reply("🚫 You are not authorized.");

    await ctx.reply(
      `👋 Welcome Admin ${ctx.from?.first_name}!`,
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Manage Riders", "menu_riders")],
        [Markup.button.callback("🍽 Manage Restaurants", "menu_restaurants")],
        [Markup.button.callback("🍔 Manage Foods", "menu_foods")],
        [Markup.button.callback("📋 Manage Orders", "menu_orders")],
        [Markup.button.callback("📦 Manage Contracts", "menu_contracts")],
      ])
    );
  });

  bot.action("menu_contracts", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "📦 Contracts Menu:\n\nUse commands:\n/contracts\n/setcontract <telegram_id> <remaining_orders>\n/deactivatecontract <telegram_id>"
    );
  });

  bot.command("contracts", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    const { data, error } = await supabase
      .from("user_contracts")
      .select("telegram_id, remaining_orders, is_active");

    if (error) return ctx.reply("⚠️ Could not fetch contracts.");
    if (!data || data.length === 0)
      return ctx.reply("No contract users found.");

    const text = data
      .map(
        (u) =>
          `👤 ID: ${u.telegram_id}\n📦 Remaining Orders: ${
            u.remaining_orders
          }\n✅ Active: ${u.is_active ? "Yes" : "No"}`
      )
      .join("\n\n");

    ctx.reply(`📋 All Contract Users:\n\n${text}`);
  });

  bot.command("setcontract", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;
    if (!isTextMessage(ctx)) return;

    const parts = ctx.message.text.split(" ");
    if (parts.length !== 3)
      return ctx.reply("⚠️ Use: /setcontract <telegram_id> <remaining_orders>");

    const targetId = Number(parts[1]);
    const remaining = Number(parts[2]);

    if (isNaN(targetId) || isNaN(remaining) || remaining < 0)
      return ctx.reply("⚠️ Invalid input.");

    const { error } = await supabase.from("user_contracts").upsert(
      [
        {
          telegram_id: targetId,
          remaining_orders: remaining,
          is_active: remaining > 0,
          updated_at: new Date(),
        },
      ],
      { onConflict: "telegram_id" }
    );

    if (error) return ctx.reply("⚠️ Could not update contract.");

    ctx.reply(
      `✅ Contract updated for user ${targetId}.\n📦 Remaining: ${remaining}\nActive: ${
        remaining > 0 ? "Yes" : "No"
      }`
    );
  });

  bot.command("deactivatecontract", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;
    if (!isTextMessage(ctx)) return;

    const parts = ctx.message.text.split(" ");
    if (parts.length !== 2)
      return ctx.reply("⚠️ Use: /deactivatecontract <telegram_id>");

    const targetId = Number(parts[1]);
    if (isNaN(targetId)) return ctx.reply("⚠️ Invalid ID");

    const { error } = await supabase
      .from("user_contracts")
      .update({ is_active: false, updated_at: new Date() })
      .eq("telegram_id", targetId);

    if (error) return ctx.reply("⚠️ Could not deactivate contract.");

    ctx.reply(`❌ Contract deactivated for user ${targetId}`);
  });

  bot.action("menu_restaurants", async (ctx) => {
    await ctx.answerCbQuery();
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
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId) return;
    adminStates.set(adminId, { action: "add_restaurant" });
    await ctx.editMessageText("🏗 Send the restaurant name:");
  });

  bot.action("list_restaurants", async (ctx) => {
    await ctx.answerCbQuery();
    const { data } = await supabase.from("restaurants").select("*").order("id");
    if (!data || data.length === 0)
      return ctx.editMessageText("📭 No restaurants found.");
    const text = data.map((r) => `ID: ${r.id} | ${r.name}`).join("\n");
    await ctx.editMessageText(`🍽 Restaurants List:\n${text}`);
  });

  bot.action("menu_foods", async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = await getRestaurantKeyboard();
    await ctx.editMessageText("🍔 Select a restaurant:", keyboard);
  });

  bot.action(/foods_restaurant_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = Number(ctx.match[1]);
    const keyboard = await getFoodKeyboard(id);
    await ctx.editMessageText("🍔 Foods:", keyboard);
  });

  bot.action(/add_food_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const restaurantId = Number(ctx.match[1]);
    const adminId = ctx.from?.id;
    if (!adminId) return;
    adminStates.set(adminId, { action: "add_food", restaurantId });
    await ctx.editMessageText("Send: Food Name | Price");
  });

  bot.action("menu_riders", async (ctx) => {
    await ctx.answerCbQuery();
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
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId) return;
    adminStates.set(adminId, { action: "add_rider" });
    await ctx.editMessageText("Send: Name | Phone | Campus");
  });

  bot.action("list_riders", async (ctx) => {
    await ctx.answerCbQuery();
    const { data } = await supabase.from("riders").select("*").order("id");
    if (!data || data.length === 0)
      return ctx.editMessageText("📭 No riders found.");
    const text = data
      .map(
        (r) =>
          `ID: ${r.id} | ${r.name} | ${r.phone} | ${r.campus} | Active: ${
            r.active ? "✅" : "❌"
          }`
      )
      .join("\n");
    await ctx.editMessageText(`👤 Riders:\n${text}`);
  });

  bot.action("menu_orders", async (ctx) => {
    await ctx.answerCbQuery();
    const { data } = await supabase.from("orders").select("*").order("id");
    if (!data || data.length === 0)
      return ctx.editMessageText("📭 No orders found.");
    const text = data
      .map(
        (o) =>
          `ID: ${o.id} | User: ${o.user_name} | Phone: ${o.phone} | Campus: ${
            o.campus
          } | Restaurant: ${o.restaurant} | Foods: ${o.foods} | Status: ${
            o.status || "Pending"
          }`
      )
      .join("\n");
    await ctx.editMessageText(`📋 Orders:\n${text}`);
  });

  bot.action("admin_back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText("🔙 Back to admin menu. Use /admin.");
  });

  bot.on("text", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId) return;
    const state = adminStates.get(adminId);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
      if (state.action === "add_restaurant") {
        const { error } = await supabase
          .from("restaurants")
          .insert([{ name: text }]);
        if (error) return ctx.reply("❌ Failed to add restaurant.");
        ctx.reply(`✅ Restaurant "${text}" added!`);
      }

      if (state.action === "add_rider") {
        const parts = text.split("|").map((p) => p.trim());
        if (parts.length !== 3)
          return ctx.reply("⚠️ Format: Name | Phone | Campus");

        const [name, phone, campus] = parts;
        const secret_code = generateSecretCode();

        const { error } = await supabase
          .from("riders")
          .insert([{ name, phone, campus, secret_code, active: true }]);

        if (error) return ctx.reply("❌ Failed to add rider.");

        ctx.reply(
          `✅ Rider added!\nName: ${name}\nPhone: ${phone}\nCampus: ${campus}\nSecret Code: ${secret_code}`
        );
      }

      if (state.action === "add_food") {
        const parts = text.split("|").map((p) => p.trim());
        if (parts.length !== 2) return ctx.reply("Format: Food Name | Price");

        const [name, priceStr] = parts;
        const price = Number(priceStr);
        if (isNaN(price)) return ctx.reply("⚠️ Price must be a number");

        const { error } = await supabase
          .from("foods")
          .insert([{ name, restaurant_id: state.restaurantId, price }]);

        if (error) return ctx.reply("❌ Failed to add food.");

        ctx.reply(`✅ Food "${name}" added with price ${price} ETB!`);
      }
    } finally {
      adminStates.delete(adminId);
    }
  });
  bot.action(/^c_(approve|reject)_(\d+)$/, async (ctx) => {
    const query = ctx.callbackQuery;

    // Ensure callbackQuery exists and has data
    if (!query || !("data" in query) || !query.data) return ctx.answerCbQuery();

    const match = query.data.match(/^c_(approve|reject)_(\d+)$/);
    if (!match) return ctx.answerCbQuery();

    const [_, action, userIdStr] = match;
    const userId = Number(userIdStr);

    if (action === "approve") {
      await supabase.from("contracts").insert({
        user_id: userId,
        is_active: true,
        remaining_orders: 5,
      });

      await supabase
        .from("contract_requests")
        .update({ status: "approved" })
        .eq("user_id", userId);

      await ctx.telegram.sendMessage(
        userId,
        "✅ Your contract has been approved! You can now use Contract Delivery option."
      );
      await ctx.editMessageText("✔ Contract approved.");
    } else {
      await supabase
        .from("contract_requests")
        .update({ status: "rejected" })
        .eq("user_id", userId);

      await ctx.telegram.sendMessage(
        userId,
        "❌ Your contract request was rejected."
      );
      await ctx.editMessageText("❌ Contract rejected.");
    }

    return ctx.answerCbQuery();
  });
}
