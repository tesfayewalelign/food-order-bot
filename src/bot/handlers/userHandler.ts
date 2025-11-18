import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  campusKeyboard,
  getRestaurantKeyboard,
  getFoodKeyboard,
} from "../../helpers/keyboards.js";

function isTextMessage(msg: any): msg is { text: string } {
  return msg && typeof msg.text === "string";
}
function isContactMessage(
  msg: any
): msg is { contact: { phone_number: string } } {
  return msg && msg.contact && typeof msg.contact.phone_number === "string";
}

const getCallbackData = (ctx: Context) =>
  (ctx.callbackQuery as { data?: string } | undefined)?.data ?? null;

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

  return contract || null;
}

const initUserState = async (userId: number, profile?: any) => {
  let state = userState.get(userId);
  if (!state) {
    state = {
      step: profile ? "ask_restaurant" : "profile_ask_name",
      foods: [],
      cartFoods: [],
      currentFood: undefined,
      currentFoodPrice: undefined,
      deliveryType: undefined,
      restaurant: profile?.restaurant || "",
      restaurantId: profile?.restaurantId || undefined,
      campus: profile?.campus || "",
      name: profile?.name || "",
      phone: profile?.phone || "",
    };
    userState.set(userId, state);
  }
  return state as UserState;
};

export function handleUserFlow(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[] = []
) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      // --- Admin ---
      if (ADMIN_IDS.includes(userId)) {
        const keyboard = getMainMenuKeyboard(true, false);
        return ctx.reply(`👋 Welcome Admin ${ctx.from?.first_name}!`, keyboard);
      }

      // --- Rider ---
      if (DRIVER_IDS.includes(userId)) {
        const keyboard = getMainMenuKeyboard(false, true);
        return ctx.reply(`🛵 Welcome Rider ${ctx.from?.first_name}!`, keyboard);
      }

      // --- Normal User ---
      resetUserState(userId);

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("telegram_id", userId)
        .maybeSingle();

      const state = await initUserState(userId, profile);

      const welcomeMessage = profile
        ? `👋 Welcome back ${profile.name}!\n\n🍽️ Campus Food Delivery - Hawassa University!\nWe bring delicious meals from nearby restaurants straight to your campus.\n\n✅ Fast & reliable delivery\n✅ Affordable prices for students\n✅ Fresh and hygienic food\n\nUse /order to start your meal or /help for assistance.`
        : `👋 Welcome to Hawassa University Campus Food Delivery!\n\n🍽️ Get fresh meals delivered straight to your campus gate.\n✅ Fast delivery in just minutes\n✅ Affordable student-friendly prices\n✅ Wide selection of tasty meals from local restaurants\n\nPlease share your full name and phone number to get started.`;

      return ctx.reply(welcomeMessage, getMainMenuKeyboard(false, false));
    } catch (err) {
      console.error("Start command error:", err);
      try {
        await ctx.reply(
          "⚠️ An error occurred during initialization. Please try again later."
        );
      } catch {}
    }
  });

  bot.on("message", async (ctx) => {
    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId) ?? (await initUserState(userId));
    const msg = ctx.message;

    if (state.step === "profile_ask_name" && isTextMessage(msg)) {
      state.name = msg.text;
      state.step = "profile_ask_phone";
      return ctx.reply(
        "📞 Please share your phone number:",
        Markup.keyboard([
          Markup.button.contactRequest("📱 Share Phone"),
        ]).resize()
      );
    }

    if (state.step === "profile_ask_phone" && isContactMessage(msg)) {
      state.phone = msg.contact.phone_number;
      state.step = "profile_ask_campus";
      return ctx.reply("🏫 Select your campus:", campusKeyboard);
    }

    if (state.step === "waiting_for_quantity" && isTextMessage(msg)) {
      const quantity = Number(msg.text);
      if (!quantity || quantity <= 0 || !Number.isInteger(quantity))
        return ctx.reply("⚠️ Enter a valid whole number.");

      state.foods.push({
        name: state.currentFood!,
        quantity,
        price: state.currentFoodPrice!,
      });
      state.currentFood = undefined;
      state.currentFoodPrice = undefined;

      if (!state.restaurantId) return ctx.reply("⚠️ No restaurant selected.");
      const keyboard = await getFoodKeyboard(state.restaurantId);
      return ctx.reply("✅ Added! Select another food or press ✅ Done.", {
        reply_markup: keyboard?.reply_markup,
      });
    }

    if (isTextMessage(msg)) {
      switch (msg.text) {
        case "🍔 Order Food":
          state.step = "profile_ask_campus";
          return ctx.reply("🍔 Choose your campus:", campusKeyboard);
        case "ℹ️ Help":
          return ctx.reply(
            "📝 Help Menu\n• 🍔 Order Food → Start order\n• 📦 My Orders → View past orders\n• 🏠 Main Menu → Back"
          );
        case "📦 My Orders":
          return ctx.reply("📂 You have no orders yet.");
        case "🏠 Main Menu":
          resetUserState(userId);
          return ctx.reply("🏠 Main Menu:", getMainMenuKeyboard(false, false));
        default:
          return ctx.reply(
            "🤔 Command not recognized. Use menu buttons or /start."
          );
      }
    }
  });

  bot.action(/^campus_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.campus = data.replace("campus_", "").replace(/_/g, " ");

    if (state.step === "profile_ask_campus") {
      await supabase.from("profiles").upsert(
        [
          {
            telegram_id: userId,
            name: state.name,
            phone: state.phone,
            campus: state.campus,
          },
        ],
        { onConflict: "telegram_id" }
      );
    }

    state.step = "ask_restaurant";
    const keyboard = await getRestaurantKeyboard();
    await ctx.editMessageText("🍴 Choose your restaurant:", {
      reply_markup: keyboard.reply_markup,
    });
    return ctx.answerCbQuery();
  });

  bot.action(/^restaurant_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    const restaurantId = data.replace("restaurant_", "");
    state.restaurantId = restaurantId;

    const { data: restaurant, error } = await supabase
      .from("restaurants")
      .select("id, name")
      .eq("id", restaurantId)
      .maybeSingle();

    if (error || !restaurant) {
      console.error("Restaurant lookup failed:", error);
      return ctx.answerCbQuery("⚠️ Restaurant not found", { show_alert: true });
    }

    state.restaurant = restaurant.name;
    state.foods = [];
    state.step = "select_food";

    const keyboard = await getFoodKeyboard(restaurantId);
    if (!keyboard)
      return ctx.editMessageText(
        `⚠️ No foods available for ${restaurant.name}`
      );

    await ctx.editMessageText(
      `🍔 *Select foods from ${restaurant.name}*\nPlease choose your items below. Press ✅ Done when finished.`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  bot.action(/^food_(.+)$/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });
    const foodId = data.replace("food_", "");
    const { data: food, error } = await supabase
      .from("foods")
      .select("*")
      .eq("id", foodId)
      .maybeSingle();

    if (error) return ctx.reply("❌ Database error fetching food.");
    if (!food) return ctx.answerCbQuery("⚠️ Food not found");

    state.currentFood = food.name;
    state.currentFoodPrice = food.price ?? 0;
    state.step = "waiting_for_quantity";

    await ctx.reply(`🍽 You selected *${food.name}*. Enter quantity:`, {
      parse_mode: "Markdown",
    });
    return ctx.answerCbQuery();
  });
  bot.action("done_food", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state || state.foods.length === 0) {
      return ctx.answerCbQuery("⚠️ Select at least one food.", {
        show_alert: true,
      });
    }

    state.step = "choose_delivery_type";
    const contract = await getUserContract(userId);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("💵 Pay on Delivery", "delivery_new")],
      ...(contract && contract.is_active && contract.remaining_orders > 0
        ? [[Markup.button.callback("📦 Use Contract", "delivery_contract")]]
        : contract
        ? []
        : [
            [Markup.button.callback("📥 Request Contract", "request_contract")],
          ]),
    ]);

    await ctx.editMessageText("🚚 Choose delivery type:", {
      reply_markup: keyboard.reply_markup,
    });

    return ctx.answerCbQuery();
  });

  bot.action("request_contract", async (ctx) => {
    const user = ctx.from!;
    const userId = user.id;

    const { data: profiles } = await supabase
      .from("users")
      .select("full_name, phone")
      .eq("telegram_id", userId)
      .maybeSingle();

    const fullName =
      profiles?.full_name ||
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
    const phone = profiles?.phone || "Not Provided";

    await supabase.from("contract_requests").insert({
      user_id: userId,
      username: user.username || null,
      full_name: fullName,
      phone: phone,
      status: "pending",
    });

    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `📥 *New Contract Request*\n\n` +
          `👤 *Name:* ${fullName}\n` +
          `📱 *Phone:* ${phone}\n` +
          `🔗 *Username:* @${user.username}\n` +
          `🆔 *Telegram ID:* ${userId}\n\n` +
          `Approve or reject:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✔ Approve", callback_data: `c_approve_${userId}` },
                { text: "❌ Reject", callback_data: `c_reject_${userId}` },
              ],
            ],
          },
        }
      );
    }

    return ctx.reply(
      "📨 Your contract request has been sent to the admin for approval."
    );
  });

  bot.action(/^delivery_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery(
        "⚠️ Session expired. Please restart with /start.",
        {
          show_alert: true,
        }
      );

    const deliveryType = data.replace("delivery_", "") as "new" | "contract";
    state.deliveryType = deliveryType;
    state.step = "confirm_order";

    const deliveryFee = deliveryType === "new" ? 10 : 0;
    const subtotal = state.foods.reduce(
      (acc, f) => acc + f.price * f.quantity,
      0
    );
    const totalPrice = subtotal + deliveryFee;

    const foodsList = state.foods
      .map((f) => `\`${f.name} x${f.quantity} = ${f.price * f.quantity} ETB\``)
      .join("\n");

    let contractInfo = "";
    if (deliveryType === "contract") {
      const contract = await getUserContract(userId);
      contractInfo = contract
        ? `📦 Remaining Contract Orders: ${contract.remaining_orders}`
        : "⚠️ Contract status unknown.";
    }

    await ctx.editMessageText(
      `🧾 *Order Summary*\n\n👤 ${state.name || "N/A"}\n📞 ${
        state.phone || "N/A"
      }\n🏫 ${state.campus || "N/A"}\n🍽 ${
        state.restaurant || "N/A"
      }\n\n🍔 *Items:*\n${foodsList}\n\n💰 Subtotal: ${subtotal} ETB\n🚚 Delivery Fee: ${deliveryFee} ETB\n💵 Total: ${totalPrice} ETB\n\n${contractInfo}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Confirm", "confirm_order"),
            Markup.button.callback("❌ Cancel", "cancel_order"),
          ],
        ]),
      }
    );
    return ctx.answerCbQuery();
  });
  bot.action("confirm_order", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state) {
      return ctx.answerCbQuery(
        "⚠️ Session expired. Please restart with /start.",
        { show_alert: true }
      );
    }

    const deliveryFee = state.deliveryType === "new" ? 10 : 0;
    const subtotal = state.foods.reduce(
      (acc, f) => acc + f.price * f.quantity,
      0
    );
    const totalPrice = subtotal + deliveryFee;
    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");

    try {
      if (state.deliveryType === "contract") {
        const contract = await getUserContract(userId);

        if (!contract) {
          return ctx.answerCbQuery(
            "⚠️ You don’t have an active contract. Please request a contract or pay per order.",
            { show_alert: true }
          );
        }

        if (!contract.is_active || contract.remaining_orders <= 0) {
          return ctx.answerCbQuery(
            "⚠️ Your contract orders are exhausted. Contact admin to reactivate.",
            { show_alert: true }
          );
        }

        const newRemaining = contract.remaining_orders - 1;
        await supabase
          .from("contracts")
          .update({ remaining_orders: newRemaining })
          .eq("id", contract.id);

        if (newRemaining === 0) {
          for (const adminId of ADMIN_IDS) {
            await ctx.telegram.sendMessage(
              adminId,
              `⚠️ Contract for @${state.username || ""} (${
                state.name
              }) has reached 0 remaining orders. Reactivation needed.`
            );
          }
        }
      }

      await supabase.from("orders").insert([
        {
          user_name: state.name,
          phone: state.phone,
          campus: state.campus,
          restaurant: state.restaurant,
          foods: foodsList,
          total: totalPrice,
          delivery_type: state.deliveryType,
          telegram_id: userId,
          status: "pending",
        },
      ]);

      const campusNormalized = state.campus
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      const { data: riders } = await supabase
        .from("riders")
        .select("telegram_id, campus")
        .eq("active", true);

      const campusRiders = riders?.filter(
        (r) =>
          r.campus.toLowerCase().replace(/\s+/g, " ").trim() ===
          campusNormalized
      );

      if (campusRiders?.length) {
        for (const r of campusRiders) {
          if (r.telegram_id) {
            await ctx.telegram.sendMessage(
              r.telegram_id,
              `🆕 *New Order*\nID: ${userId}\n🍔 ${state.restaurant}\n👤 ${state.name}\n🏫 ${state.campus}\n📞 ${state.phone}\n💰 Total: ${totalPrice} ETB\n📝 Foods: ${foodsList}`,
              { parse_mode: "Markdown" }
            );
          }
        }
      } else {
        console.warn(`No active riders found for campus: ${state.campus}`);
      }

      resetUserState(userId);

      await ctx.editMessageText(
        "✅ Order placed successfully! The restaurant is preparing your food. You will be notified when a rider picks it up."
      );

      return ctx.answerCbQuery();
    } catch (err) {
      console.error("Confirm order error:", err);
      return ctx.answerCbQuery(
        "❌ Order failed due to a database error. Please try again.",
        { show_alert: true }
      );
    }
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from!.id;
    resetUserState(userId);
    await ctx.editMessageText(
      "❌ Order cancelled. Type /start to begin a new order."
    );
    return ctx.answerCbQuery();
  });
}
