// src/index.ts
import bot, { initBot } from "./bot/bot.js";

(async () => {
  try {
    await initBot();
    await bot.launch();
    console.log("🤖 Bot is running...");
  } catch (err) {
    console.error("[INDEX] Failed to start bot:", err);
  }
})();
