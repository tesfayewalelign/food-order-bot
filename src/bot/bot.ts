import dotenv from "dotenv";
import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../config/supabase.js";
import { setupAdminHandler } from "./handlers/adminHandler.js";
import { setupDriverHandler } from "./handlers/driverHandler.js";
import { handleUserFlow } from "./handlers/userHandler.js";
import { setupStartHandler } from "./handlers/startHandler.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Telegraf<Context>(BOT_TOKEN);

async function initBot() {
  const ADMIN_IDS: number[] = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id): id is number => !isNaN(id));

  const { data: drivers, error } = await supabase
    .from("riders")
    .select("telegram_id");

  if (error) console.error("[BOT] Error fetching drivers:", error.message);

  const DRIVER_IDS =
    drivers
      ?.map((d) => Number(d.telegram_id))
      .filter((id): id is number => !isNaN(id)) ?? [];

  console.log("Admin IDs:", ADMIN_IDS);
  console.log("Driver IDs:", DRIVER_IDS);
  handleUserFlow(bot, ADMIN_IDS, DRIVER_IDS); // handleUserFlow
  setupStartHandler(bot, ADMIN_IDS, DRIVER_IDS);

  setupAdminHandler(bot, ADMIN_IDS);

  setupDriverHandler(bot, DRIVER_IDS);

  console.log("[BOT] Bot initialized successfully.");
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

initBot().catch((err) => console.error("[BOT] Init error:", err));

export default bot;
