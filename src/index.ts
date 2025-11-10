import dotenv from "dotenv";
dotenv.config();
import bot from "./bot/bot";

bot.launch();
console.log("🤖 Telegram bot is running...");
