import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { handleUserFlow } from "./handlers/userHandler.js";
import { handleAdmin } from "./handlers/adminHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
const safeToken = encodeURIComponent(BOT_TOKEN);
console.log("BOT_TOKEN", safeToken);

const bot = new Telegraf(safeToken);

handleUserFlow(bot);
handleAdmin(bot);

// bot.launch();
console.log("🤖 Bot is running...");

export default bot;
