import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";
import {
  resetUserState,
  initUserState,
  userState,
  UserState,
} from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  campusKeyboard,
} from "../../helpers/keyboards.js";

function isContactMessage(
  msg: any
): msg is { contact: { phone_number: string } } {
  return !!msg.contact && !!msg.contact.phone_number;
}

export function setupStartHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      if (ADMIN_IDS.includes(userId)) {
        return ctx.reply(
          `👋 Welcome Admin ${ctx.from?.first_name}!`,
          getMainMenuKeyboard(true, false)
        );
      }

      resetUserState(userId);

      const { data: profile } = await supabase
        .from("profiles")
        .select("telegram_id, name, phone, campus")
        .eq("telegram_id", userId)
        .maybeSingle();

      const fullName =
        profile?.name ||
        `${ctx.from?.first_name ?? ""} ${ctx.from?.last_name ?? ""}`.trim();

      const { error: userError } = await supabase.from("users").upsert(
        {
          id: userId,
          username: ctx.from?.username || null,
          full_name: fullName,
          created_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (userError) {
        console.error("Error upserting user:", userError);
        return ctx.reply("❌ Failed to initialize user. Try again later.");
      }

      if (!profile) {
        const state: UserState = await initUserState(userId);
        state.step = "profile_ask_name";
        userState.set(userId, state);
        return ctx.reply("👤 Welcome! Please enter your full name:");
      }

      return ctx.reply(
        `👋 Welcome back ${profile.name}!`,
        getMainMenuKeyboard(false, false)
      );
    } catch (err) {
      console.error("Start command error:", err);
      await ctx.reply(
        "⚠️ An error occurred during initialization. Please try again later."
      );
    }
  });

  // --- Handle new user registration flow ---
  bot.on("message", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const state = userState.get(userId);
    if (!state) return next();

    const msg: any = ctx.message;

    // 1️⃣ Ask full name
    if (state.step === "profile_ask_name" && "text" in msg) {
      state.name = msg.text.trim();
      state.step = "profile_ask_phone";
      userState.set(userId, state);

      return ctx.reply(
        "📞 Please share your phone number:",
        Markup.keyboard([
          Markup.button.contactRequest("📱 Share Phone"),
        ]).resize()
      );
    }

    // 2️⃣ Ask phone via Telegram contact
    if (state.step === "profile_ask_phone" && isContactMessage(msg)) {
      state.phone = msg.contact.phone_number;
      state.step = "profile_ask_campus";
      userState.set(userId, state);

      return ctx.reply("🏫 Select your campus:", campusKeyboard);
    }

    // 3️⃣ Ask campus
    if (state.step === "profile_ask_campus" && "text" in msg) {
      state.campus = msg.text.trim();
      state.step = "idle";
      userState.set(userId, state);
      await supabase.from("profiles").upsert({
        telegram_id: userId,
        name: state.name,
        phone: state.phone,
        campus: state.campus,
      });

      return ctx.reply(
        `✅ Registration complete, ${state.name}! You can now use the bot.`,
        getMainMenuKeyboard(false, false)
      );
    }

    return next();
  });

  // --- Existing /activate command ---
  bot.command("activate", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const parts = text.split(" ");
    if (parts.length < 2)
      return ctx.reply("❗ Please send the code like this:\n/activate 4790");

    const code = parts[1]?.trim();
    if (!code) return ctx.reply("❗ Invalid code format.");

    try {
      const { data: rider } = await supabase
        .from("riders")
        .select("*")
        .eq("secret_code", code)
        .single();

      if (!rider)
        return ctx.reply("❌ Rider not found. Please check your code.");

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
