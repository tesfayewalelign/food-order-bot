// src/bot/bot.ts
import dotenv from "dotenv";
import { Telegraf, Context } from "telegraf";
import { supabase } from "../config/supabase.js";
import { setupAdminHandler } from "./handlers/adminHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";
import { handleUserFlow } from "./handlers/userHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("[BOT] BOT_TOKEN missing in .env");

const bot = new Telegraf<Context>(BOT_TOKEN);

/** Fetch admin IDs from .env */
function getAdminIdsFromEnv(): number[] {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id): id is number => !isNaN(id));
}

/** Fetch driver IDs from Supabase */
async function getDriverIdsFromSupabase(): Promise<number[]> {
  const { data, error } = await supabase.from("riders").select("telegram_id");

  if (error) {
    console.error("[BOT] Error fetching drivers:", error.message);
    return [];
  }

  return (
    data
      ?.map((d) => Number(d.telegram_id))
      .filter((id): id is number => !isNaN(id)) ?? []
  );
}

export async function initBot() {
  const ADMIN_IDS = getAdminIdsFromEnv();
  const DRIVER_IDS = await getDriverIdsFromSupabase();

  console.log("[BOT] Admin IDs:", ADMIN_IDS);
  console.log("[BOT] Driver IDs:", DRIVER_IDS);

  // ----- Setup Handlers -----
  setupAdminHandler(bot, ADMIN_IDS);
  setupDriverHandler(bot);
  handleUserFlow(bot, ADMIN_IDS, DRIVER_IDS);

  console.log("[BOT] Bot initialized successfully.");
}

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default bot;
