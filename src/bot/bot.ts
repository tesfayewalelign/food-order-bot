// src/bot/bot.ts
import dotenv from "dotenv";
import { Telegraf, Context } from "telegraf";
import { supabase } from "../config/supabase.js";
import { setupAdminHandler } from "./handlers/adminHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";
import { handleUserFlow } from "./handlers/userHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf<Context>(BOT_TOKEN);

async function initBot() {
  const ADMIN_IDS: number[] = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id): id is number => !isNaN(id));

  const { data: drivers } = await supabase.from("riders").select("telegram_id");
  const DRIVER_IDS = drivers?.map((d) => d.telegram_id).filter(Boolean) ?? [];

  console.log("Admin IDs:", ADMIN_IDS);
  console.log("Driver IDs:", DRIVER_IDS);

  setupAdminHandler(bot, ADMIN_IDS);
  setupDriverHandler(bot);
  handleUserFlow(bot, ADMIN_IDS, DRIVER_IDS);
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

initBot();

export default bot;
