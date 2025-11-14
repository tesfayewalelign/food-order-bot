import { Telegraf, Context, Markup } from "telegraf";
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

function isTextMessage(msg: any): msg is { text: string } {
  return msg && typeof msg.text === "string";
}

function isContactMessage(
  msg: any
): msg is { contact: { phone_number: string } } {
  return (
    msg &&
    typeof msg.contact === "object" &&
    typeof msg.contact.phone_number === "string"
  );
}

const getCallbackData = (ctx: Context): string | null => {
  const callbackQuery = ctx.callbackQuery as { data?: string } | undefined;
  return callbackQuery?.data ?? null;
};

const initUserState = async (
  userId: number,
  profile?: any
): Promise<UserState> => {
  let state = userState.get(userId);
  if (!state) {
    state = {
      step: profile ? "profile_ask_campus" : "profile_ask_name",
      foods: [],
      cartFoods: [],
      currentFood: undefined,
      deliveryType: undefined,
      restaurant: profile?.restaurant,
      campus: profile?.campus,
      name: profile?.name || "",
      phone: profile?.phone || "",
    };
    userState.set(userId, state);
  }
  return state;
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

    const state = await initUserState(userId, profile);

    if (profile) {
      await ctx.reply(
        `👋 Welcome back ${profile.name}!\nSelect an option below:`,
        getMainMenuKeyboard(false, false)
      );
    } else {
      await ctx.reply("📋 Welcome! What's your full name?");
    }
  });

  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId) || (await initUserState(userId));

    const message = ctx.message;

    if (state.step === "profile_ask_name" && isTextMessage(message)) {
      state.name = message.text;
      state.step = "profile_ask_phone";

      await ctx.reply(
        "📞 Please share your phone number:",
        Markup.keyboard([
          Markup.button.contactRequest("Share Phone Number"),
        ]).resize()
      );
      return;
    }

    if (state.step === "profile_ask_phone" && isContactMessage(message)) {
      state.phone = message.contact.phone_number;
      state.step = "profile_ask_campus";

      await ctx.reply("🏫 Select your campus:", campusKeyboard);
      return;
    }

    if (state.step === "waiting_for_quantity" && isTextMessage(message)) {
      const quantity = parseInt(message.text);
      if (isNaN(quantity) || quantity <= 0) {
        await ctx.reply("⚠️ Please enter a valid number.");
        return;
      }

      state.foods.push({ name: state.currentFood!, quantity });
      state.currentFood = undefined;
      state.step = "select_food";

      await ctx.reply(
        "✅ Added to cart! Select another food or press ✅ Done when finished.",
        foodKeyboard
      );
      return;
    }

    if (isTextMessage(message)) {
      switch (message.text) {
        case "🍔 Order Food":
          state.step = "profile_ask_campus";
          await ctx.reply(
            "🍔 Let's start your order. Choose your campus:",
            campusKeyboard
          );
          return;

        case "ℹ️ Help":
          await ctx.reply(
            "📝 Help:\n1. 🍔 Order Food → Start a new order\n2. 📦 My Orders → Check past orders\n3. 🏠 Main Menu → Go back to main menu"
          );
          return;

        case "📦 My Orders":
          await ctx.reply("📂 You have no orders yet.");
          return;

        case "🏠 Main Menu":
          await ctx.reply("🏠 Main Menu:", getMainMenuKeyboard(false, false));
          return;
      }
    }
  });

  bot.action(/^campus_(.+)/, async (ctx) => {
    const userId = ctx.from?.id!;
    const state = userState.get(userId);
    if (!state) return;

    const match = getCallbackData(ctx)?.match(/^campus_(.+)$/);
    if (!match || !match[1]) return; // <-- ensure match[1] exists

    state.campus = match[1].replace(/_/g, " ");

    // Save new user to DB
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
    await ctx.editMessageText("🍴 Choose your restaurant:", restaurantKeyboard);
    await ctx.answerCbQuery();
  });

  // ---- Restaurant selection ----
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

  // ---- Food selection ----
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
    if (!state || state.foods.length === 0) {
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
    if (state.deliveryType === "contract")
      contractInfo = `📦 Remaining Contract Orders: ${remainingContracts}`;

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

    if (state.deliveryType === "contract") {
      if (remainingContracts <= 0) {
        await ctx.reply(
          "❌ Sorry, there are no remaining contract orders available at the moment."
        );
        resetUserState(userId);
        await ctx.answerCbQuery();
        return;
      }
      remainingContracts--;
    }

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");
    const totalPrice = state.foods.reduce((acc, f) => acc + f.quantity * 50, 0);

    let deliveryInfo = "";
    if (state.deliveryType === "contract") {
      deliveryInfo = `📦 Remaining Contract Orders: ${remainingContracts}`;
    } else {
      deliveryInfo = "💵 Pay on delivery";
    }

    await ctx.reply(
      `✅ Order confirmed! Your delivery is being prepared.\n\n` +
        `🧾 *Final Order Summary*\n\n` +
        `👤 Name: ${state.name}\n` +
        `📞 Phone: ${state.phone}\n` +
        `🏫 Campus: ${state.campus}\n` +
        `🍽 Restaurant: ${state.restaurant}\n` +
        `🍔 Foods: ${foodsList}\n` +
        `🚚 ${deliveryInfo}\n` +
        `💰 Total: ${totalPrice} ETB`,
      { parse_mode: "Markdown" }
    );

    resetUserState(userId);
    await ctx.answerCbQuery();
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from?.id!;
    resetUserState(userId);
    await ctx.reply("❌ Order cancelled. Start again anytime with /start");
    await ctx.answerCbQuery();
  });
}
