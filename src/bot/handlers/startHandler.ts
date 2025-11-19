import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { resetUserState, userState, UserState } from "../../helpers/state.js";
import { getMainMenuKeyboard } from "../../helpers/keyboards.js";
import { initUserState } from "../../helpers/state.js";

export function setupStartHandler(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[]
) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      // ----------------------------
      // Admin
      // ----------------------------
      if (ADMIN_IDS.includes(userId)) {
        const keyboard = getMainMenuKeyboard(true, false); // Admin buttons
        return ctx.reply(`👋 Welcome Admin ${ctx.from?.first_name}!`, keyboard);
      }

      // ----------------------------
      // Rider / Driver
      // ----------------------------
      if (DRIVER_IDS.includes(userId)) {
        const keyboard = getMainMenuKeyboard(false, true); // Driver buttons
        return ctx.reply(`🛵 Welcome Rider ${ctx.from?.first_name}!`, keyboard);
      }

      // ----------------------------
      // Normal user
      // ----------------------------
      // Reset state for new session
      resetUserState(userId);

      // Fetch user profile from database
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("telegram_id", userId)
        .maybeSingle();

      const state = await initUserState(userId, profile);

      // Welcome message depending on profile existence
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
}
