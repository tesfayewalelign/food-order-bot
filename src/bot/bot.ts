import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import { supabase } from "../config/supabase.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf(BOT_TOKEN);

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

let DRIVER_ID = process.env.DRIVER_TELEGRAM_ID
  ? Number(process.env.DRIVER_TELEGRAM_ID)
  : null;

interface OrderItem {
  foodId: string;
  foodName: string;
  foodPrice: number;
  quantity: number;
}

interface Food {
  id: string;
  name: string;
  price: number;
  restaurant_id: string;
}

interface Restaurant {
  id: string;
  name: string;
}

interface UserState {
  step?: string;
  name?: string;
  phone?: string;
  campus?: string;
  restaurantId?: string;
  restaurantName?: string;
  cart?: OrderItem[];
  cartFoods?: Food[];
  deliveryType?: "new" | "contract";
  remainingContract?: number;
  editFoodId?: string;
}

const states = new Map<number, UserState>();

function isAdmin(id?: number) {
  return id !== undefined && ADMIN_IDS.includes(id);
}

async function ensureUserRow(
  telegramId: number,
  name?: string,
  phone?: string,
  campus?: string
) {
  const { data: existing, error } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (existing) {
    const updates: any = {};
    if (name && name !== existing.name) updates.name = name;
    if (phone && phone !== existing.phone) updates.phone = phone;
    if (campus && campus !== existing.campus) updates.campus = campus;
    if (
      existing.remaining_contract === null ||
      existing.remaining_contract === undefined
    ) {
      updates.remaining_contract = 30;
    }
    if (Object.keys(updates).length > 0)
      await supabase
        .from("users")
        .update(updates)
        .eq("telegram_id", telegramId);
    return existing;
  } else {
    const { data } = await supabase
      .from("users")
      .insert([
        {
          telegram_id: telegramId,
          name,
          phone,
          campus,
          remaining_contract: 30,
        },
      ])
      .select()
      .maybeSingle();
    return data;
  }
}

function getMainMenuKeyboard(isAdminUser = false) {
  const buttons: string[][] = [["📦 Start Order"], ["ℹ️ Help", "👋 Welcome"]];
  if (isAdminUser) buttons.push(["✏️ Edit Foods", "💰 View Orders"]);
  return Markup.keyboard(buttons).resize();
}

function twoColumnKeyboard(items: string[]) {
  const kb: string[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    kb.push(items.slice(i, i + 2));
  }
  return Markup.keyboard(kb).resize();
}

async function sendWelcome(ctx: any) {
  const tid = ctx.from?.id!;
  await ctx.reply(
    "👋 Welcome to the Campus Food Delivery Bot!\nUse the menu below to get started.",
    getMainMenuKeyboard(isAdmin(tid))
  );
}

bot.start(sendWelcome);
bot.hears("👋 Welcome", sendWelcome);

bot.hears("ℹ️ Help", async (ctx) => {
  await ctx.reply(
    "📖 *Help Guide*\n\n" +
      "1️⃣ Press '📦 Start Order' to begin a new order.\n" +
      "2️⃣ Follow the steps to enter your name, phone, and campus.\n" +
      "3️⃣ Choose your restaurant and foods.\n" +
      "4️⃣ Choose delivery type: new or contract.\n" +
      "5️⃣ Confirm your order and it will be sent to our driver 🚚.\n\n" +
      "For any issues, contact support or an admin.",
    { parse_mode: "Markdown" }
  );
});

bot.hears("✏️ Edit Foods", async (ctx) => {
  const tid = ctx.from?.id;
  if (!isAdmin(tid)) return ctx.reply("❌ You are not an admin.");

  const { data: foods } = await supabase
    .from("foods")
    .select("*")
    .order("name");
  if (!foods || foods.length === 0) return ctx.reply("No foods found to edit.");

  const names = foods.map((f: Food) => `${f.name} (${f.price} ETB)`);
  states.set(tid!, { step: "edit_select_food", cartFoods: foods });
  return ctx.reply("Select a food to edit:", twoColumnKeyboard(names));
});

bot.on("text", async (ctx) => {
  const tid = ctx.from?.id!;
  const text = ctx.message.text.trim();
  let state = states.get(tid) || { step: "" };

  if (!DRIVER_ID && ctx.message?.from?.is_bot === false) {
    if (text === "/register_driver") {
      DRIVER_ID = tid;
      return ctx.reply("✅ You are now registered as the driver.");
    }
  }

  if (text === "📦 Start Order") {
    const user = await ensureUserRow(tid);
    const remaining = user.remaining_contract ?? 30;
    states.set(tid, {
      step: "ask_name",
      cart: [],
      remainingContract: remaining,
    });

    return ctx.reply("👋 What's your full name?");
  }

  if (state.step === "edit_select_food") {
    const selectedFood = state.cartFoods?.find(
      (f: Food) => `${f.name} (${f.price} ETB)` === text
    );
    if (!selectedFood) return ctx.reply("❌ Food not found. Try again.");

    state.editFoodId = selectedFood.id;
    state.step = "edit_enter_price";
    states.set(tid, state);
    return ctx.reply(
      `💰 Enter new price for *${selectedFood.name}* (current: ${selectedFood.price} ETB):`,
      { parse_mode: "Markdown" }
    );
  }

  if (state.step === "edit_enter_price") {
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) return ctx.reply("❌ Invalid price.");

    await supabase.from("foods").update({ price }).eq("id", state.editFoodId);
    states.delete(tid);
    return ctx.reply(`✅ Price updated successfully to ${price} ETB.`);
  }

  switch (state.step) {
    case "ask_name":
      state.name = text;
      state.step = "ask_phone";
      states.set(tid, state);
      return ctx.reply("📱 Enter your phone number:");

    case "ask_phone":
      if (!/^[0-9]{6,13}$/.test(text))
        return ctx.reply("❌ Invalid phone number.");
      state.phone = text;
      state.step = "choose_campus";
      states.set(tid, state);
      return ctx.reply(
        "🏫 Choose your campus:",
        twoColumnKeyboard([
          "Main boy dorm",
          "Main female dorm",
          "Techno boy dorm",
          "Techno female dorm",
        ])
      );

    case "choose_campus":
      const campuses = [
        "Main boy dorm",
        "Main female dorm",
        "Techno boy dorm",
        "Techno female dorm",
      ];
      if (!campuses.includes(text))
        return ctx.reply("❌ Please choose a valid campus from the buttons.");
      state.campus = text;
      state.step = "choose_restaurant";
      states.set(tid, state);

      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("*")
        .order("name");
      if (!restaurants || restaurants.length === 0)
        return ctx.reply("⚠️ No restaurants available right now.");

      const restaurantNames = restaurants.map((r: Restaurant) => r.name);
      states.set(tid, { ...state, cartFoods: [] });
      return ctx.reply(
        "🍴 Choose a restaurant:",
        twoColumnKeyboard(restaurantNames)
      );

    case "choose_restaurant":
      const { data: selectedRest } = await supabase
        .from("restaurants")
        .select("*")
        .eq("name", text)
        .maybeSingle();
      if (!selectedRest)
        return ctx.reply("❌ Please select a valid restaurant.");

      state.restaurantId = selectedRest.id;
      state.restaurantName = selectedRest.name;
      state.step = "choose_food";

      const { data: foods } = await supabase
        .from("foods")
        .select("*")
        .eq("restaurant_id", selectedRest.id)
        .order("name");
      if (!foods || foods.length === 0)
        return ctx.reply("⚠️ No foods found for this restaurant.");

      state.cartFoods = foods;
      states.set(tid, state);

      const foodNames = foods.map((f: Food) => `${f.name} (${f.price} ETB)`);
      return ctx.reply(
        "🍛 Choose your food (add multiple items, then click '✅ Done'):",
        twoColumnKeyboard([...foodNames, "✅ Done"])
      );

    case "choose_food":
      if (text === "✅ Done") {
        if (!state.cart || state.cart.length === 0)
          return ctx.reply("❌ You must select at least one food.");
        state.step = "choose_delivery";
        states.set(tid, state);
        return ctx.reply(
          "🚚 Choose delivery type:",
          twoColumnKeyboard(["new", "contract"])
        );
      }

      const selectedFood = state.cartFoods?.find(
        (f: Food) => `${f.name} (${f.price} ETB)` === text
      );
      if (!selectedFood)
        return ctx.reply("❌ Please choose a valid food from the list.");

      state.cart = state.cart || [];
      state.cart.push({
        foodId: selectedFood.id,
        foodName: selectedFood.name,
        foodPrice: selectedFood.price,
        quantity: 1,
      });
      states.set(tid, state);

      return ctx.reply(
        `✅ Added ${selectedFood.name}. You can add more or click "✅ Done" when finished.`,
        twoColumnKeyboard([
          ...(state.cartFoods ?? []).map((f) => `${f.name} (${f.price} ETB)`),
          "✅ Done",
        ])
      );

    case "choose_delivery":
      if (text !== "new" && text !== "contract")
        return ctx.reply("❌ Choose a valid delivery type.");

      state.deliveryType = text as "new" | "contract";
      state.step = "confirm_order";
      states.set(tid, state);

      const cartItems = state.cart ?? [];
      const totalPrice = cartItems.reduce(
        (sum, i) => sum + i.foodPrice * i.quantity,
        0
      );

      return ctx.reply(
        `🛒 *Order Summary*\n\n🍽 ${state.restaurantName}\n${cartItems
          .map((c) => `🍔 ${c.foodName} x${c.quantity}`)
          .join("\n")}\n💰 Total: ${totalPrice} ETB\n` +
          (state.deliveryType === "contract"
            ? `🔢 Remaining contract orders: ${state.remainingContract}\n`
            : "") +
          `\n✅ Confirm order?`,
        {
          parse_mode: "Markdown",
          ...Markup.keyboard([["✅ Confirm", "❌ Cancel"]]).resize(),
        }
      );

    case "confirm_order":
      if (text === "✅ Confirm") {
        await ensureUserRow(tid, state.name, state.phone, state.campus);
        const totalPrice =
          state.cart?.reduce((sum, i) => sum + i.foodPrice * i.quantity, 0) ??
          0;

        const { data: insertedOrder } = await supabase
          .from("orders")
          .insert([
            {
              user_id: tid,
              restaurant_id: state.restaurantId,
              total_price: totalPrice,
              delivery_type: state.deliveryType,
              created_at: new Date(),
            },
          ])
          .select()
          .maybeSingle();

        let newRemaining = state.remainingContract;
        if (state.deliveryType === "contract") {
          newRemaining = (state.remainingContract ?? 0) - 1;
          await supabase
            .from("users")
            .update({ remaining_contract: newRemaining })
            .eq("telegram_id", tid);
        }

        if (DRIVER_ID && insertedOrder) {
          await bot.telegram.sendMessage(
            DRIVER_ID,
            `🚨 *New Order Received* 🚨

👤 Name: ${state.name}
🏫 Campus: ${state.campus}
🍽 Restaurant: ${state.restaurantName}
🛒 Items:
${state.cart?.map((c) => `- ${c.foodName} x${c.quantity}`).join("\n")}
💰 Total: ${totalPrice} ETB
🚚 Delivery: ${state.deliveryType}`,
            { parse_mode: "Markdown" }
          );
        }

        states.delete(tid);
        return ctx.reply(
          "🎉 Your order has been placed successfully!\nWe’ll deliver it soon 🚚.",
          getMainMenuKeyboard()
        );
      } else if (text === "❌ Cancel") {
        states.delete(tid);
        return ctx.reply("❌ Order cancelled.", getMainMenuKeyboard());
      }
      break;
  }
});

export default bot;
