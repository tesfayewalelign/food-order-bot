import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";

export function setupDriverHandler(bot: Telegraf, ADMIN_IDS: number[]) {
  bot.command("add_rider", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!ADMIN_IDS.includes(userId!)) {
      return ctx.reply("🚫 You are not authorized to add riders.");
    }

    if (!ctx.message || !("text" in ctx.message)) {
      return ctx.reply("⚠️ Please use the command in text format.");
    }

    const text = ctx.message.text.trim();

    const match = text.match(/^\/add_rider\s+(\d+)\s+(\S+)\s+"([^"]+)"$/);

    if (!match) {
      return ctx.reply(
        `⚠️ Invalid format.\n\nExample:\n/add_rider 7289662736 Besukal "Techno Boys Dorm"`
      );
    }

    const [, phone, name, location] = match;

    try {
      const { data, error } = await supabase
        .from("riders")
        .insert([
          {
            name,
            phone,
            location,
            telegram_id: userId,
            active: true,
          },
        ])
        .select();

      if (error) {
        console.error(error);
        return ctx.reply(`❌ Error adding rider: ${error.message}`);
      }

      ctx.reply(
        `✅ Rider added successfully!\n👤 Name: ${name}\n📞 Phone: ${phone}\n🏠 Location: ${location}`
      );
    } catch (err) {
      console.error(err);
      ctx.reply("⚠️ Something went wrong while adding rider.");
    }
  });
}
