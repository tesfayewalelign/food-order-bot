import { Telegraf, Context } from "telegraf";
import dotenv from "dotenv";
import { handleUserFlow } from "./handlers/userHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";
import { setupAdminHandler } from "./handlers/adminHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in .env");

const bot = new Telegraf<Context>(BOT_TOKEN);

export const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id));

console.log("Loaded Admin IDs:", ADMIN_IDS);
setupAdminHandler(bot, ADMIN_IDS);
setupDriverHandler(bot, ADMIN_IDS);
handleUserFlow(bot);

bot.catch((err, ctx) => {
  console.error(`Error for user ${ctx.from?.id}:`, err);
  ctx.reply("⚠️ Something went wrong. Please try again later.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default bot;
