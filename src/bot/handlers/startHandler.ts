import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";
import {
  resetUserState,
  initUserState,
  userState,
  UserState,
} from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  customerMenuKeyboard,
  riderMenuKeyboard,
  adminReplyKeyboard,
} from "../../helpers/keyboards.js";
import { getUserRole } from "../../helpers/roles.js";

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
      resetUserState(userId);
      const role = await getUserRole(userId);

      if (role === "admin") {
        return ctx.reply(
          `🛡️ *Admin Control Center*\n\nWelcome back Admin, *${ctx.from?.first_name || "Admin"}*! Select an option below to manage the platform.`,
          {
            parse_mode: "Markdown",
            ...adminReplyKeyboard,
          }
        );
      }

      if (role === "rider") {
        const riderRes = await db.execute({
          sql: "SELECT * FROM riders WHERE telegram_id = ? AND active = 1",
          args: [userId],
        });
        const rider = riderRes.rows[0];

        userState.set(userId, {
          isRider: true,
          campus: String(rider?.campus || ""),
          step: "idle",
          username: ctx.from?.username,
          name: String(rider?.name || ctx.from?.first_name || "Rider"),
          phone: String(rider?.phone || ""),
          foods: [],
          cartFoods: [],
          deliveryType: undefined,
        });

        return ctx.reply(
          `🛵 *Rider Portal*\n\nWelcome back Rider, *${rider?.name || "Rider"}*! Manage your deliveries and schedule using the menu below.`,
          {
            parse_mode: "Markdown",
            ...riderMenuKeyboard,
          }
        );
      }

      // Customer Flow
      const profRes = await db.execute({
        sql: "SELECT telegram_id, name, phone, campus FROM profiles WHERE telegram_id = ?",
        args: [userId],
      });
      const profile = profRes.rows[0];

      if (!profile) {
        const state: UserState = await initUserState(userId);
        state.step = "profile_ask_name";
        userState.set(userId, state);
        return ctx.reply(
          "👤 *Welcome to Campus Food Delivery!*\n\nPlease enter your full name to get started:",
          { parse_mode: "Markdown" }
        );
      }

      userState.set(userId, {
        step: "idle",
        name: String(profile.name),
        phone: String(profile.phone),
        campus: String(profile.campus || ""),
        foods: [],
        cartFoods: [],
      });

      return ctx.reply(
        `👋 *Welcome back, ${profile.name}!*\n\nWhat would you like to do today?`,
        {
          parse_mode: "Markdown",
          ...customerMenuKeyboard,
        }
      );
    } catch (err) {
      console.error("Start command error:", err);
      await ctx.reply(
        "⚠️ An error occurred during initialization. Please try again later."
      );
    }
  });

  bot.on("message", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const state = userState.get(userId);
    if (!state) return next();

    const msg: any = ctx.message;

    if (state.step === "profile_ask_name" && "text" in msg) {
      state.name = msg.text.trim();
      state.step = "profile_ask_phone";
      userState.set(userId, state);

      return ctx.reply(
        `📞 Thank you, *${state.name}*! Please share your phone number to complete registration:`,
        {
          parse_mode: "Markdown",
          ...Markup.keyboard([
            Markup.button.contactRequest("📱 Share Phone"),
          ]).resize(),
        }
      );
    }

    if (
      state.step === "profile_ask_phone" &&
      (isContactMessage(msg) || ("text" in msg && msg.text))
    ) {
      const phone = isContactMessage(msg)
        ? msg.contact.phone_number
        : msg.text.trim();
      state.phone = phone;
      state.step = "idle";
      userState.set(userId, state);

      await db.execute({
        sql: `INSERT INTO profiles (telegram_id, name, phone, campus)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, phone=excluded.phone;`,
        args: [userId, state.name || "User", state.phone || "", state.campus || ""],
      });

      return ctx.reply(
        `👋 *Welcome to Campus Food Delivery, ${state.name}!*\n\n` +
          `🎉 Registration complete! You can now browse food, view past orders, or contact support using the buttons below.`,
        {
          parse_mode: "Markdown",
          ...customerMenuKeyboard,
        }
      );
    }

    return next();
  });

  bot.command("activate", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const parts = text.split(" ");
    if (parts.length < 2)
      return ctx.reply("❗ Please send the code like this:\n/activate 4790");

    const code = parts[1]?.trim();
    if (!code) return ctx.reply("❗ Invalid code format.");

    try {
      const riderRes = await db.execute({
        sql: "SELECT * FROM riders WHERE secret_code = ? AND active = 1",
        args: [String(code || "")],
      });
      const rider = riderRes.rows[0];

      if (!rider)
        return ctx.reply("❌ Rider not found or inactive. Please check your activation code with the admin.");

      await db.execute({
        sql: "UPDATE riders SET telegram_id = ? WHERE id = ?",
        args: [ctx.from!.id, Number(rider.id)],
      });

      return ctx.reply(
        `✅ Activation successful! Welcome Rider ${rider.name} 🚴‍♂️`,
        riderMenuKeyboard
      );
    } catch (err) {
      console.error("Activation error:", err);
      return ctx.reply("❌ Activation failed. Please try again.");
    }
  });
}
