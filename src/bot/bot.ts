// src/bot/bot.ts
import { Telegraf, Context, Markup } from "telegraf";
import dotenv from "dotenv";
import { supabase } from "../config/supabase.js";
import { setupAdminHandler } from "./handlers/adminHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";
import { handleUserFlow } from "./handlers/userHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

export const ADMIN_IDS: number[] = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()));

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx: Context) => {
  const userId = ctx.from?.id;
  const firstName = ctx.from?.first_name;

  if (!userId) return;

  if (ADMIN_IDS.includes(userId)) {
    return ctx.reply(
      `Welcome Admin ${firstName}! You can add riders or view orders.`
    );
  }

  const { data: rider } = await supabase
    .from("riders")
    .select("*")
    .eq("telegram_id", userId)
    .single();

  if (rider) {
    return ctx.reply(
      `Welcome Rider ${firstName}! You can now accept/reject orders.`
    );
  }

  const { data: pendingRider } = await supabase
    .from("riders")
    .select("*")
    .is("telegram_id", null)
    .eq("name", firstName)
    .single();

  if (pendingRider) {
    await supabase
      .from("riders")
      .update({ telegram_id: userId })
      .eq("id", pendingRider.id);

    return ctx.reply("✅ You are now registered as a Rider!");
  }

  return ctx.reply(`Welcome ${firstName}! You can place orders using the bot.`);
});

setupAdminHandler(bot, ADMIN_IDS);
setupDriverHandler(bot, ADMIN_IDS);
handleUserFlow(bot);

export default bot;
