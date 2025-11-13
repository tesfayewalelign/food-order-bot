import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  campusKeyboard,
  restaurantKeyboard,
  foodKeyboard,
  confirmKeyboard,
  deliveryKeyboard,
} from "../../helpers/keyboards.js";

let remainingContracts = 30;

const getCallbackData = (ctx: Context): string | null => {
  const callbackQuery = ctx.callbackQuery as { data?: string } | undefined;
  return callbackQuery?.data ?? null;
};

export function handleUserFlow(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id!;
    resetUserState(userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("telegram_id", userId)
      .single();

    if (profile) {
      await ctx.reply(
        `👋 Welcome back ${profile.name}!\nSelect an option below:`,
        getMainMenuKeyboard(false, false)
      );
      return;
    }

    userState.set(userId, {
      step: "profile_ask_name",
      foods: [],
      cartFoods: [],
      currentFood: undefined,
      deliveryType: undefined,
      restaurant: undefined,
      campus: undefined,
      name: "",
      phone: "",
    });

    await ctx.reply("📋 Welcome new user! What's your full name?");
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from?.id!;
    const text = ctx.message?.text?.trim();
    if (!text) return;

    let state: UserState | undefined = userState.get(userId);

    if (!state) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("telegram_id", userId)
        .single();

      if (text === "🍔 Order Food") {
        if (!profile) {
          userState.set(userId, {
            step: "profile_ask_name",
            foods: [],
            cartFoods: [],
            currentFood: undefined,
            deliveryType: undefined,
            restaurant: undefined,
            campus: undefined,
            name: "",
            phone: "",
          });
          await ctx.reply(
            "📋 You need a profile first. What's your full name?"
          );
          return;
        }

        userState.set(userId, {
          step: "select_food",
          foods: [],
          cartFoods: [],
          currentFood: undefined,
          deliveryType: undefined,
          restaurant: undefined,
          campus: profile.campus,
          name: profile.name,
          phone: profile.phone,
        });

        await ctx.reply(
          `🍔 Welcome ${profile.name}! Choose your restaurant:`,
          restaurantKeyboard
        );
        return;
      }

      if (text === "ℹ️ Help") {
        await ctx.reply(
          "📝 Help:\n1. 🍔 Order Food → Start a new order\n2. 📦 My Orders → Check past orders\n3. 🏠 Main Menu → Go back to main menu"
        );
        return;
      }

      if (text === "📦 My Orders") {
        await ctx.reply("📂 You have no orders yet.");
        return;
      }

      return;
    }

    switch (state.step) {
      case "profile_ask_name":
        state.name = text;
        state.step = "profile_ask_phone";
        await ctx.reply("📞 Enter your phone number:");
        return;

      case "profile_ask_phone":
        state.phone = text;
        state.step = "profile_ask_campus";
        await ctx.reply("🏫 Enter your campus:");
        return;

      case "profile_ask_campus":
        state.campus = text;
        state.step = "profile_ask_dorm";
        await ctx.reply("🏠 Enter your dorm:");
        return;

      case "profile_ask_dorm":
        const dorm = text;

        await supabase.from("profiles").upsert({
          telegram_id: userId,
          name: state.name,
          phone: state.phone,
          campus: state.campus,
          dorm,
        });

        resetUserState(userId);

        await ctx.reply(
          `✅ Profile created! Welcome ${state.name}.\nSelect an option below:`,
          getMainMenuKeyboard(false, false)
        );
        return;
    }

    switch (state.step) {
      case "waiting_for_quantity":
        const count = parseInt(text);
        if (isNaN(count) || count <= 0) {
          await ctx.reply("⚠️ Please enter a valid number (e.g., 1, 2, 3).");
          return;
        }

        if (state.currentFood) {
          state.foods.push({ name: state.currentFood, quantity: count });
          state.currentFood = undefined;
        }

        state.step = "select_food";
        await ctx.reply(
          "🍔 You can now choose another food or press ✅ Done when finished:",
          foodKeyboard
        );
        break;
    }
  });

  bot.action(/^campus_(.+)/, async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    const match = getCallbackData(ctx)?.match(/^campus_(.+)$/);
    if (!match || !match[1]) return;

    state!.campus = match[1].replace(/_/g, " ");
    state!.step = "ask_restaurant";

    await ctx.editMessageText("🍴 Choose your restaurant:", restaurantKeyboard);
    await ctx.answerCbQuery();
  });

  bot.action(/^restaurant_(.+)/, async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    const match = getCallbackData(ctx)?.match(/^restaurant_(.+)$/);
    if (!match) return;

    state.restaurant = match[1];
    state.foods = [];
    state.step = "select_food";

    await ctx.editMessageText(
      `🍔 Select foods from ${state.restaurant}. Press ✅ Done when finished:`,
      foodKeyboard
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^food_(.+)/, async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    const match = getCallbackData(ctx)?.match(/^food_(.+)$/);
    if (!match) return;

    state.currentFood = match[1];
    state.step = "waiting_for_quantity";

    await ctx.reply(`🍽 You selected *${state.currentFood}*. Enter quantity:`, {
      parse_mode: "Markdown",
    });
    await ctx.answerCbQuery();
  });

  bot.action("done_food", async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state || !state.foods.length) {
      await ctx.reply("⚠️ Please select at least one food before continuing.");
      return;
    }

    state.step = "choose_delivery_type";
    await ctx.reply("🚚 Choose delivery type:", deliveryKeyboard);
    await ctx.answerCbQuery();
  });

  bot.action(/^delivery_(.+)/, async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    const match = getCallbackData(ctx)?.match(/^delivery_(.+)$/);
    if (!match) return;

    state.deliveryType = match[1] as "new" | "contract";
    state.step = "confirm_order";

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");
    const totalPrice = state.foods.reduce((acc, f) => acc + f.quantity * 50, 0);

    let contractInfo = "";
    if (state.deliveryType === "contract") {
      contractInfo = `📦 Remaining Contract Orders: ${remainingContracts}`;
    }

    await ctx.reply(
      `🧾 *Final Order Summary*\n\n` +
        `👤 Name: ${state.name}\n` +
        `📞 Phone: ${state.phone}\n` +
        `🏫 Campus: ${state.campus}\n` +
        `🍽 Restaurant: ${state.restaurant}\n` +
        `🍔 Foods: ${foodsList}\n` +
        `🚚 Delivery Type: ${
          state.deliveryType === "contract" ? "Contract" : "Pay"
        }\n` +
        `${contractInfo}\n` +
        `💰 Total: ${totalPrice} ETB`,
      { parse_mode: "Markdown", ...confirmKeyboard }
    );

    await ctx.answerCbQuery();
  });

  bot.action("confirm_order", async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    let contractInfo = "";
    if (state.deliveryType === "contract") {
      remainingContracts--;
      contractInfo = `📦 Remaining Contract Orders: ${remainingContracts}`;
    }

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");
    const totalPrice = state.foods.reduce((acc, f) => acc + f.quantity * 50, 0);

    await ctx.reply(
      `✅ Order confirmed! Your delivery is being prepared.\n\n` +
        `🧾 *Final Order Summary*\n\n` +
        `👤 Name: ${state.name}\n` +
        `📞 Phone: ${state.phone}\n` +
        `🏫 Campus: ${state.campus}\n` +
        `🍽 Restaurant: ${state.restaurant}\n` +
        `🍔 Foods: ${foodsList}\n` +
        `🚚 Delivery Type: ${
          state.deliveryType === "contract" ? "Contract" : "Pay"
        }\n` +
        `${contractInfo}\n` +
        `💰 Total: ${totalPrice} ETB`,
      { parse_mode: "Markdown" }
    );

    resetUserState(userId);
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from?.id!;
    resetUserState(userId);
    await ctx.reply("❌ Order cancelled. Start again anytime with /start");
    await ctx.answerCbQuery();
  });
}
