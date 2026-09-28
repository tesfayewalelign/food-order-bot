import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { Telegraf, Context } from "telegraf";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

import { initDb } from "./config/db.js";

import { setupAdminHandler } from "./bot/handlers/adminHandler.js";
import { setupDriverHandler } from "./bot/handlers/driverHandler.js";
import { setupStartHandler } from "./bot/handlers/startHandler.js";
import { handleUserFlow } from "./bot/handlers/userHandler.js";

await initDb();

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

bot.catch((err: any, ctx: Context) => {
  console.error(`⚠️ Unhandled bot error for update ${ctx.update?.update_id}:`, err);
  ctx.reply("⚠️ An unexpected error occurred. Please try again.").catch(() => {});
});

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const isProduction = process.env.NODE_ENV === "production" && WEBHOOK_URL;

if (isProduction) {
  app.use(express.json());
  app.use(bot.webhookCallback("/webhook"));

  app.get("/", (req, res) => {
    res.send("🤖 Bot is running via webhook!");
  });

  app.listen(PORT, async () => {
    console.log(`🌐 Server running on port ${PORT}`);

    try {
      await bot.telegram.setWebhook(WEBHOOK_URL!);
      console.log("✅ Webhook set:", WEBHOOK_URL);
    } catch (err) {
      console.error("❌ Failed to set webhook:", err);
    }
  });
} else {
  console.log("🚀 Starting bot in long-polling mode for local testing...");
  
  bot.telegram.deleteWebhook().then(() => {
    bot.launch(() => {
      console.log("✅ Bot is online and listening for Telegram updates via polling!");
    });
  }).catch((err) => {
    console.error("⚠️ Failed to delete webhook, attempting launch anyway:", err);
    bot.launch();
  });

  app.get("/", (req, res) => {
    res.send("🤖 Bot is running locally via polling!");
  });

  app.listen(PORT, () => {
    console.log(`🌐 Health server running on port ${PORT}`);
  });
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
