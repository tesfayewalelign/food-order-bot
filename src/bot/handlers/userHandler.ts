import { Telegraf, Context } from "telegraf";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  campusKeyboard,
  restaurantKeyboard,
  confirmKeyboard,
} from "../../helpers/keyboards.js";
import { supabase } from "../../config/supabase.js";
import {
  getUserByPhone,
  createUser,
  decrementContract,
} from "../../helpers/utils.js";

export function handleUserFlow(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id!;
    resetUserState(userId);
    userState.set(userId, { step: "ask_name" });
    await ctx.reply("👋 Welcome! Please enter your full name:");
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from?.id!;
    const text = ctx.message.text;
    const state: UserState | undefined = userState.get(userId);
    if (!state) return;

    switch (state.step) {
      case "ask_name":
        state.name = text;
        state.step = "ask_phone";
        await ctx.reply("📞 Enter your phone number:");
        break;

      case "ask_phone":
        state.phone = text;
        state.step = "ask_campus";
        await ctx.reply("🏫 Select your campus:", campusKeyboard);
        break;

      case "ask_campus":
        if (!text.startsWith("🏫")) return;
        state.campus = text.replace("🏫 ", "");
        state.step = "ask_restaurant";
        await ctx.reply("🍴 Choose your restaurant/cafe:", restaurantKeyboard);
        break;

      case "ask_restaurant":
        if (!text.startsWith("🍽")) return;
        state.restaurant = text.replace("🍽 ", "");
        state.step = "ask_food";
        await ctx.reply(
          `🍔 What food would you like to order from ${state.restaurant}?`
        );
        break;

      case "ask_food":
        state.food = text;
        state.step = "ask_count";
        await ctx.reply("🔢 How many items do you want?");
        break;

      case "ask_count":
        const count = parseInt(text);
        if (isNaN(count) || count <= 0) {
          return ctx.reply("⚠️ Please enter a valid number.");
        }
        state.count = count;
        state.step = "confirm";

        let user = await getUserByPhone(state.phone!);
        if (!user) {
          user = await createUser({
            telegram_id: userId,
            phone: state.phone!,
            name: state.name!,
            campus: state.campus!,
            is_contract: false,
            remaining_contract: null,
          });
        }

        const remaining = user.is_contract
          ? user.remaining_contract ?? 0
          : "N/A";
        const total = (state.count ?? 0) * 50;

        await ctx.reply(
          `🧾 Order Summary\n\n👤 Name: ${state.name}\n📞 Phone: ${state.phone}\n🏫 Campus: ${state.campus}\n🍽 Restaurant: ${state.restaurant}\n🍔 Food: ${state.food}\n🔢 Quantity: ${state.count}\n🚚 Remaining Deliveries: ${remaining}\n💰 Total: ${total} ETB`,
          confirmKeyboard
        );
        break;
    }
  });

  bot.action("confirm_order", async (ctx) => {
    const userId = ctx.from?.id!;
    const state: UserState | undefined = userState.get(userId);
    if (!state) return ctx.reply("⚠️ No order in progress.");

    const user = await getUserByPhone(state.phone!);
    if (!user) return ctx.reply("⚠️ User not found.");

    if (user.is_contract) {
      if (!user.remaining_contract || user.remaining_contract <= 0) {
        return ctx.reply(
          "🚫 Your contract deliveries are finished. Contact admin to renew."
        );
      }
      const newRemaining = await decrementContract(state.phone!);
      await ctx.reply(
        `✅ Order confirmed!\n🚚 Deliveries left: ${newRemaining}`
      );
    } else {
      await ctx.reply("✅ Order confirmed! (Pay per order)");
    }

    await supabase.from("orders").insert([
      {
        user_id: userId,
        name: state.name!,
        phone: state.phone!,
        campus: state.campus!,
        restaurant: state.restaurant!,
        food: state.food!,
        quantity: state.count ?? 0,
        total: (state.count ?? 0) * 50,
      },
    ]);

    resetUserState(userId);
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from?.id!;
    resetUserState(userId);
    await ctx.reply(
      "❌ Order cancelled. You can start again anytime with /start"
    );
  });
}
