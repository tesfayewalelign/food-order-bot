import { Telegraf, Context } from "telegraf";
import dotenv from "dotenv";
import { handleUserFlow } from "./handlers/userHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing in .env");

const bot = new Telegraf<Context>(BOT_TOKEN);

handleUserFlow(bot);

bot.catch((err, ctx) => {
  console.error(`Error for user ${ctx.from?.id}:`, err);
  ctx.reply("⚠️ Something went wrong. Please try again later.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default bot;
