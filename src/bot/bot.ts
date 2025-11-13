import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { handleUserFlow } from "./handlers/userHandler.js";
import { handleAdmin } from "./handlers/adminHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";

dotenv.config();

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()));

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

// ✅ No need to encode BOT_TOKEN — Telegraf handles it fine
const bot = new Telegraf(BOT_TOKEN);

handleUserFlow(bot);
handleAdmin(bot);
setupDriverHandler(bot, ADMIN_IDS); // ✅ now bot exists

console.log("🤖 Bot is running...");

export default bot;
