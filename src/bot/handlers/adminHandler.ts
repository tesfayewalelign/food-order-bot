import { Telegraf, Context } from "telegraf";
import { isAdmin, resetContract } from "../../helpers/utils.js";

export function handleAdmin(bot: Telegraf<Context>) {
  bot.command("reset_delivery", async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return ctx.reply("🚫 You’re not authorized.");

    const text = ctx.message.text.split(" ");
    const phone = text[1];
    if (!phone)
      return ctx.reply(
        "⚠️ Please provide phone number. Example: /reset_delivery +251900000000"
      );

    await resetContract(phone);
    await ctx.reply(`✅ Deliveries reset to 30 for ${phone}`);
  });
}
