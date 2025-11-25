import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { resetUserState, initUserState } from "../../helpers/state.js";
import { getMainMenuKeyboard } from "../../helpers/keyboards.js";

export function setupStartHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      if (ADMIN_IDS.includes(userId)) {
        const keyboard = getMainMenuKeyboard(true, false);
        return ctx.reply(`👋 Welcome Admin ${ctx.from?.first_name}!`, keyboard);
      }

      resetUserState(userId);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("name, phone, telegram_id")
        .eq("telegram_id", userId)
        .maybeSingle();
      if (profileError) console.error(profileError);

      const { data: riderCheck, error: riderError } = await supabase
        .from("riders")
        .select("*")
        .eq("telegram_id", userId)
        .maybeSingle();
      if (riderError) console.error(riderError);

      if (riderCheck) {
        return ctx.reply(
          `🛵 Welcome Rider ${profile?.name || "Rider"}!`,
          getMainMenuKeyboard(false, true)
        );
      }

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

  bot.command("activate", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const parts = text.split(" ");

    if (parts.length < 2) {
      return ctx.reply("❗ Please send the code like this:\n/activate 4790");
    }

    const code = parts[1]?.trim();
    if (!code) return ctx.reply("❗ Invalid code format.");

    try {
      console.log("Activation code received:", code);

      const { data: rider, error } = await supabase
        .from("riders")
        .select("*")
        .eq("secret_code", code)
        .single();

      if (error || !rider) {
        console.log("Error:", error);
        return ctx.reply("❌ Rider not found. Please check your code.");
      }

      await supabase
        .from("riders")
        .update({ telegram_id: ctx.from!.id })
        .eq("id", rider.id);

      return ctx.reply(
        `✅ Activation successful! Welcome Rider ${rider.name} 🚴‍♂️`,
        getMainMenuKeyboard(false, true)
      );
    } catch (err) {
      console.error("Activation error:", err);
      return ctx.reply("❌ Activation failed. Please try again.");
    }
  });
}
