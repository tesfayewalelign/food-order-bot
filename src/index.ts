import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

import { setupAdminHandler } from "./bot/handlers/adminHandler.js";
import { setupDriverHandler } from "./bot/handlers/driverHandler.js";
import { setupStartHandler } from "./bot/handlers/startHandler.js";
import { handleUserFlow } from "./bot/handlers/userHandler.js";

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
setupAdminHandler(bot, ADMIN_IDS);
setupDriverHandler(bot);
handleUserFlow(bot, ADMIN_IDS, DRIVER_IDS);

const WEBHOOK_URL = `https://food-order-bot-6f0w.onrender.com/webhook`;

app.use(express.json());
app.use(bot.webhookCallback("/webhook"));

app.get("/", (req, res) => {
  res.send("🤖 Bot is running via webhook!");
});

app.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);

  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log("✅ Webhook set:", WEBHOOK_URL);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err);
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
