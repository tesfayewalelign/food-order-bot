import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  campusKeyboard,
  restaurantKeyboard,
  deliveryKeyboard,
} from "../../helpers/keyboards.js";
import { getFoodKeyboard } from "./adminHandler.js";

let remainingContracts = 30;

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

export function handleUserFlow(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[] = []
) {
  bot.start(async (ctx) => {
    const userId = ctx.from!.id;

    if (ADMIN_IDS.includes(userId)) {
      return ctx.reply(
        `👋 Welcome Admin ${ctx.from?.first_name}!`,
        getMainMenuKeyboard(true, false)
      );
    }

    if (DRIVER_IDS.includes(userId)) {
      return ctx.reply(
        `🛵 Welcome Rider ${ctx.from?.first_name}!`,
        getMainMenuKeyboard(false, true)
      );
    }

    resetUserState(userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("telegram_id", userId)
      .single();
    const state = await initUserState(userId, profile);

    if (profile)
      return ctx.reply(
        `👋 Welcome back ${profile.name}!`,
        getMainMenuKeyboard(false, false)
      );

    return ctx.reply("📋 Welcome! What's your full name?");
  });

  bot.on("message", async (ctx) => {
    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    let state = userState.get(userId) || (await initUserState(userId));
    const msg = ctx.message;

    if (state.step === "profile_ask_name" && isTextMessage(msg)) {
      state.name = msg.text;
      state.step = "profile_ask_phone";
      return ctx.reply(
        "📞 Please share your phone number:",
        Markup.keyboard([
          Markup.button.contactRequest("Share Phone Number"),
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
      if (!quantity || quantity <= 0)
        return ctx.reply("⚠️ Enter valid number.");

      state.foods.push({ name: state.currentFood!, quantity });
      state.currentFood = undefined;
      state.step = "select_food";

      if (!state.restaurant) return ctx.reply("⚠️ No restaurant selected yet.");

      const keyboard = await getFoodKeyboard(state.restaurant);
      return ctx.reply("✅ Added! Select another food or press ✅ Done.", {
        reply_markup: keyboard.reply_markup,
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
          return ctx.reply("🏠 Main Menu:", getMainMenuKeyboard(false, false));
      }
    }
  });

  bot.action(/^campus_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state) return;

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
    const keyboard = await restaurantKeyboard();
    await ctx.editMessageText("🍴 Choose your restaurant:", {
      reply_markup: keyboard.reply_markup,
    });
    return ctx.answerCbQuery();
  });

  bot.action(/^restaurant_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state) return;

    state.restaurant = data.replace("restaurant_", "");
    state.foods = [];
    state.step = "select_food";

    if (!state.restaurant) return ctx.reply("⚠️ No restaurant selected.");

    const keyboard = await getFoodKeyboard(state.restaurant);
    await ctx.editMessageText(
      `🍔 Select foods from ${state.restaurant}. Press ✅ Done when finished:`,
      { reply_markup: keyboard.reply_markup }
    );
    return ctx.answerCbQuery();
  });

  bot.action(/^food_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state) return;

    state.currentFood = data.replace("food_", "");
    state.step = "waiting_for_quantity";

    await ctx.reply(`🍽 You selected *${state.currentFood}*. Enter quantity:`, {
      parse_mode: "Markdown",
    });
    return ctx.answerCbQuery();
  });

  bot.action("done_food", async (ctx) => {
    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state || state.foods.length === 0)
      return ctx.reply("⚠️ Please select at least one food.");

    state.step = "choose_delivery_type";
    await ctx.reply("🚚 Choose delivery type:", deliveryKeyboard);
    return ctx.answerCbQuery();
  });

  bot.action(/^delivery_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state) return;

    state.deliveryType = data.replace("delivery_", "") as "new" | "contract";
    state.step = "confirm_order";

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");
    const totalPrice = state.foods.reduce((acc, f) => acc + f.quantity * 50, 0);
    const contractInfo =
      state.deliveryType === "contract"
        ? `📦 Remaining Contract Orders: ${remainingContracts}`
        : "";

    await ctx.reply(
      `🧾 *Order Summary*\n\n👤 ${state.name}\n📞 ${state.phone}\n🏫 ${
        state.campus
      }\n🍽 ${state.restaurant}\n🍔 ${foodsList}\n🚚 ${
        state.deliveryType === "contract" ? "Contract" : "Pay on delivery"
      }\n${contractInfo}\n💰 Total: ${totalPrice} ETB`,
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
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    const state = userState.get(userId);
    if (!state) return;

    if (state.deliveryType === "contract") remainingContracts--;

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");
    const totalPrice = state.foods.reduce((acc, f) => acc + f.quantity * 50, 0);

    const { data: newOrder, error } = await supabase
      .from("orders")
      .insert([
        {
          user_name: state.name,
          phone: state.phone,
          campus: state.campus,
          restaurant: state.restaurant,
          foods: foodsList,
          total: totalPrice,
          delivery_type: state.deliveryType,
          remaining_contracts: remainingContracts,
        },
      ])
      .select()
      .single();

    if (error) return ctx.reply("⚠️ Something went wrong.");

    const { data: riders } = await supabase
      .from("riders")
      .select("telegram_id, name")
      .eq("campus", state.campus)
      .eq("active", true);

    if (riders?.length) {
      for (const r of riders) {
        if (r.telegram_id) {
          await ctx.telegram.sendMessage(
            r.telegram_id,
            `🆕 *New Order*\n🍔 ${state.restaurant}\n👤 ${state.name}\n🏫 ${state.campus}\n📞 ${state.phone}\n💰 ${totalPrice} ETB`,
            {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "✅ Accept",
                    `accept_order_${newOrder.id}`
                  ),
                  Markup.button.callback(
                    "❌ Reject",
                    `reject_order_${newOrder.id}`
                  ),
                ],
              ]),
            }
          );
        }
      }
    }

    resetUserState(userId);
    return ctx.answerCbQuery();
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from!.id;
    if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

    resetUserState(userId);
    await ctx.reply("❌ Order cancelled.");
    return ctx.answerCbQuery();
  });
}
