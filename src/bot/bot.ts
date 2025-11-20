import { Telegraf } from "telegraf";
import { supabase } from "../config/supabase.js";

export const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id));

export let DRIVER_IDS: number[] = [];

export const loadDriverIds = async () => {
  const { data, error } = await supabase
    .from("riders")
    .select("telegram_id")
    .eq("active", true);

  if (error) {
    console.error("Failed to load driver IDs:", error);
    return;
  }

  DRIVER_IDS = (data || [])
    .map((r: any) => Number(r.telegram_id))
    .filter((id) => !isNaN(id));

  console.log("Loaded Drivers from DB:", DRIVER_IDS);
};

export const bot = new Telegraf(process.env.BOT_TOKEN!);

await loadDriverIds();

console.log("Admin IDs:", ADMIN_IDS);
console.log("Driver IDs:", DRIVER_IDS);
console.log("Bot is ready.");
