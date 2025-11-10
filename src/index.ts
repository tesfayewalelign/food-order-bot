import dotenv from "dotenv";
dotenv.config();

import bot from "./bot/bot.js";

async function startBot() {
  try {
    await bot.launch();
    console.log("🤖 Telegram bot is running...");
  } catch (err: any) {
    if (err.response && err.response.error_code === 409) {
      console.log("⚠️ Another instance is running. Restarting in 5s...");
      setTimeout(startBot, 5000);
    } else {
      console.error("❌ Bot failed to start:", err);
    }
  }
}

startBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
