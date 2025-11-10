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

interface UserState {
  step?: string;
  name?: string;
  phone?: string;
  campus?: string;
  restaurantId?: string;
  restaurantName?: string;
  foodId?: string;
  foodName?: string;
  foodPrice?: number;
  quantity?: number;
  deliveryType?: "new" | "contract";
}

const states = new Map<number, UserState>();

async function ensureUserRow(
  telegramId: number,
  name?: string,
  phone?: string,
  campus?: string
) {
  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    const updates: any = {};
    if (name && name !== existing.name) updates.name = name;
    if (phone && phone !== existing.phone) updates.phone = phone;
    if (campus && campus !== existing.campus) updates.campus = campus;
    if (Object.keys(updates).length > 0) {
      await supabase
        .from("users")
        .update(updates)
        .eq("telegram_id", telegramId);
    }
    return existing;
  } else {
    const { data, error } = await supabase
      .from("users")
      .insert([{ telegram_id: telegramId, name, phone, campus }])
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}

function isAdmin(id?: number) {
  return id !== undefined && ADMIN_IDS.includes(id);
}

async function seedDefaultFoods(restaurantId: string) {
  const defaultFoods = [
    "Aynet",
    "Pasta be atkilit",
    "Pasta be sgo",
    "Dnch",
    "Firfir",
    "Alcha firfir",
    "Timatim lebleb",
    "Timatim sils",
    "Enkulal sils",
    "Enkulal firfir",
  ];
  for (const f of defaultFoods) {
    const { data: exists } = await supabase
      .from("foods")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("name", f)
      .maybeSingle();
    if (!exists) {
      await supabase
        .from("foods")
        .insert({ name: f, price: 50, restaurant_id: restaurantId });
    }
  }
}

function buildKeyboardButtons(
  items: any[],
  callbackPrefix: string,
  columns = 2
) {
  const keyboard: any[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const row: any[] = [];
    for (let j = 0; j < columns; j++) {
      if (items[i + j]) {
        row.push(
          Markup.button.callback(
            items[i + j].name +
              (items[i + j].price ? ` (${items[i + j].price})` : ""),
            `${callbackPrefix}_${items[i + j].id}`
          )
        );
      }
    }
    keyboard.push(row);
  }
  return keyboard;
}

bot.start(async (ctx) => {
  const tid = ctx.from?.id!;
  states.set(tid, { step: "ask_name" });
  await ctx.reply("👋 Welcome! What's your full name?");
});

bot.on("text", async (ctx) => {
  const tid = ctx.from?.id!;
  const text = ctx.message.text.trim();
  let state = states.get(tid) || { step: "ask_name" };

  if (state.step === "ask_name") {
    state.name = text;
    state.step = "ask_phone";
    states.set(tid, state);
    await ctx.reply("📱 Please enter your phone number (digits only):");
    return;
  }

  if (state.step === "ask_phone") {
    const phoneRegex = /^[0-9]{6,13}$/;
    if (!phoneRegex.test(text)) {
      await ctx.reply("❌ Invalid phone. Enter digits only (6-13 digits).");
      return;
    }
    state.phone = text;
    state.step = "choose_campus";
    states.set(tid, state);
    await ctx.reply(
      "🏫 Select your campus:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Main boy dorm", "campus_Main boy dorm")],
        [Markup.button.callback("Main female dorm", "campus_Main female dorm")],
        [Markup.button.callback("Techno boy dorm", "campus_Techno boy dorm")],
        [
          Markup.button.callback(
            "Techno female dorm",
            "campus_Techno female dorm"
          ),
        ],
      ])
    );
    return;
  }

  await ctx.reply("Send /start to begin an order.");
});

bot.action(/campus_(.+)/, async (ctx) => {
  const tid = ctx.from?.id!;
  const selected = ctx.match?.[1];
  let state = states.get(tid);
  if (!state || !selected) {
    await ctx.answerCbQuery("Session expired. Send /start.").catch(() => {});
    await ctx.editMessageText("❌ Session expired. Send /start to begin.");
    return;
  }

  state.campus = selected;
  state.step = "choose_restaurant";
  states.set(tid, state);
  await ctx.answerCbQuery().catch(() => {});

  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("*")
    .order("name", { ascending: true });

  if (!restaurants || restaurants.length === 0) {
    await ctx.editMessageText(
      "No restaurants found. Ask admin to add restaurants."
    );
    return;
  }

  const keyboard = buildKeyboardButtons(restaurants, "rest", 2);
  await ctx.editMessageText(
    "🍽 Choose a restaurant or cafe:",
    Markup.inlineKeyboard(keyboard)
  );
});

bot.action(/rest_(.+)/, async (ctx) => {
  const tid = ctx.from?.id!;
  const restaurantId = ctx.match?.[1];
  let state = states.get(tid);

  if (!state || !restaurantId) {
    await ctx.answerCbQuery("Session expired. Send /start.").catch(() => {});
    await ctx.editMessageText("❌ Session expired. Send /start to begin.");
    return;
  }

  const { data: r, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .maybeSingle();

  if (error || !r) {
    await ctx.answerCbQuery("Restaurant not found.").catch(() => {});
    await ctx.editMessageText(
      "❌ Restaurant not found. Send /start to try again."
    );
    return;
  }

  state.restaurantId = r.id;
  state.restaurantName = r.name;
  state.step = "choose_food";
  states.set(tid, state);
  await ctx.answerCbQuery().catch(() => {});

  let { data: foods } = await supabase
    .from("foods")
    .select("*")
    .eq("restaurant_id", restaurantId);

  if (!foods || foods.length === 0) {
    await seedDefaultFoods(restaurantId);
    const { data: newFoods } = await supabase
      .from("foods")
      .select("*")
      .eq("restaurant_id", restaurantId);
    foods = newFoods || [];
  }

  const keyboard = buildKeyboardButtons(foods, "food", 2);
  await ctx.editMessageText(
    "🍲 Select food (price shown):",
    Markup.inlineKeyboard(keyboard)
  );
});

bot.action(/food_(.+)/, async (ctx) => {
  const tid = ctx.from?.id!;
  const foodId = ctx.match?.[1];
  let state = states.get(tid);

  if (!state || !foodId) {
    await ctx.answerCbQuery("Session expired. Send /start.").catch(() => {});
    await ctx.editMessageText("❌ Session expired. Send /start to begin.");
    return;
  }

  const { data: food } = await supabase
    .from("foods")
    .select("*")
    .eq("id", foodId)
    .maybeSingle();

  if (!food) {
    await ctx.answerCbQuery("Food not found.").catch(() => {});
    return;
  }

  state.foodId = food.id;
  state.foodName = food.name;
  state.foodPrice = Number(food.price);
  state.quantity = 1;
  state.step = "choose_delivery";
  states.set(tid, state);
  await ctx.answerCbQuery().catch(() => {});

  await ctx.editMessageText(
    `You picked: ${state.foodName} — ${state.foodPrice}\nChoose delivery type:`,
    Markup.inlineKeyboard([
      Markup.button.callback("New Delivery", "delivery_new"),
      Markup.button.callback("Contract Delivery", "delivery_contract"),
    ])
  );
});

bot.action(/delivery_(.+)/, async (ctx) => {
  const tid = ctx.from?.id!;
  const deliveryType = ctx.match?.[1] as "new" | "contract";
  let state = states.get(tid);
  if (!state || !deliveryType) {
    await ctx.answerCbQuery("Session expired. Send /start.").catch(() => {});
    await ctx.editMessageText("❌ Session expired. Send /start to begin.");
    return;
  }

  state.deliveryType = deliveryType;
  states.set(tid, state);
  await ctx.answerCbQuery().catch(() => {});

  const total = (state.foodPrice ?? 0) * (state.quantity ?? 1);
  await ctx.editMessageText(
    `Confirm order:\nName: ${state.name}\nPhone: ${state.phone}\nCampus: ${
      state.campus
    }\nRestaurant: ${state.restaurantName}\nFood: ${state.foodName}\nQty: ${
      state.quantity
    }\nDelivery: ${deliveryType}\nTotal: ${total.toFixed(2)}`,
    Markup.inlineKeyboard([
      Markup.button.callback("Confirm ✅", "confirm_order"),
      Markup.button.callback("Cancel ❌", "cancel_order"),
    ])
  );
});

bot.action("confirm_order", async (ctx) => {
  const tid = ctx.from?.id!;
  const state = states.get(tid);
  if (!state) {
    await ctx.answerCbQuery("Session expired. Send /start.").catch(() => {});
    return;
  }

  const userRow = await ensureUserRow(
    tid,
    state.name,
    state.phone,
    state.campus
  );
  if (!userRow) {
    await ctx.answerCbQuery("User error.").catch(() => {});
    return;
  }

  const total = (state.foodPrice ?? 0) * (state.quantity ?? 1);
  await supabase.from("orders").insert([
    {
      user_id: userRow.id,
      restaurant_id: state.restaurantId,
      food_id: state.foodId,
      delivery_type: state.deliveryType,
      quantity: state.quantity ?? 1,
      total_price: total,
    },
  ]);

  await ctx.editMessageText(
    `✅ Thank you! Your order was recorded. Total: ${total.toFixed(2)}`
  );
  states.delete(tid);
});

bot.action("cancel_order", async (ctx) => {
  const tid = ctx.from?.id!;
  states.delete(tid);
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText(
    "❌ Order cancelled. Send /start to begin a new order."
  );
});

bot.command("seed_cafes_foods", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.reply("⛔ Not authorized.");
  const cafes = [
    "askuala",
    "fike",
    "mesi",
    "pepsi",
    "shewit",
    "adonay",
    "am",
    "ahadu",
    "selam",
  ];
  for (const cafe of cafes) {
    let { data: rest } = await supabase
      .from("restaurants")
      .select("*")
      .eq("name", cafe)
      .maybeSingle();
    if (!rest) {
      const { data: newRest } = await supabase
        .from("restaurants")
        .insert({ name: cafe })
        .select()
        .maybeSingle();
      rest = newRest;
    }
    await seedDefaultFoods(rest.id);
  }
  await ctx.reply("✅ All cafes and foods seeded correctly.");
});
export default bot;

bot.launch();
console.log("🤖 Telegram bot is running...");
