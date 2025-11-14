import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { ADMIN_IDS } from "../bot.js";

export function setupDriverHandler(bot: Telegraf, ADMIN_IDS: number[]) {
  bot.action(/accept_order_(\d+)/, async (ctx) => {
    const callback = ctx.callbackQuery;
    if (!("data" in callback)) return;

    const orderId = Number(callback.data.replace("accept_order_", ""));
    const riderId = ctx.from?.id!;

    const { error } = await supabase
      .from("orders")
      .update({ status: "accepted", assigned_rider: riderId })
      .eq("id", orderId);

    if (error) return ctx.reply("⚠️ Failed to accept order.");

    await ctx.editMessageText("✅ Order accepted! Delivering...");
  });

  bot.action(/reject_order_(\d+)/, async (ctx) => {
    const callback = ctx.callbackQuery;
    if (!("data" in callback)) return;

    const orderId = Number(callback.data.replace("reject_order_", ""));

    const { error } = await supabase
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", orderId);

    if (error) return ctx.reply("⚠️ Failed to reject order.");

    await ctx.editMessageText(
      "❌ You rejected the order (Admin will reassign)."
    );
  });
}
