import { Telegraf } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

import { supabase } from "./config/supabase";
import { setupAdminHandler } from "./bot/handlers/adminHandler";
import { setupDriverHandler } from "./bot/handlers/driverHandler";
import { setupStartHandler } from "./bot/handlers/startHandler";
import { handleUserFlow } from "./bot/handlers/userHandler";
export const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id));

export const DRIVER_IDS = (process.env.DRIVER_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id));

if (!process.env.BOT_TOKEN) {
  console.error("❌ Missing BOT_TOKEN in .env");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

setupStartHandler(bot, ADMIN_IDS);
handleUserFlow(bot, ADMIN_IDS, DRIVER_IDS);
setupAdminHandler(bot, ADMIN_IDS);
setupDriverHandler(bot);

bot
  .launch()
  .then(() => console.log("🤖 Bot is running successfully..."))
  .catch((err) => console.error("❌ Failed to launch bot:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
