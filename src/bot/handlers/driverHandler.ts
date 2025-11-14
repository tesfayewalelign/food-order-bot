// src/bot/handlers/driverHandler.ts
import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

// Type guard for text messages
function isTextMessage(
  ctx: Context
): ctx is Context & { message: { text: string } } {
  return (
    !!ctx.message &&
    "text" in ctx.message &&
    typeof ctx.message.text === "string"
  );
}

export function setupDriverHandler(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[]
) {
  // ==================== Start / Activate Rider ====================
  bot.start(async (ctx) => {
    await ctx.reply(
      "👋 Welcome Rider!\nPlease enter your secret code to activate your account:"
    );
  });

  bot.on("text", async (ctx) => {
    if (!isTextMessage(ctx)) return;
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const enteredCode = ctx.message.text.trim();

    const { data: rider, error } = await supabase
      .from("riders")
      .select("*")
      .eq("secret_code", enteredCode)
      .single();

    if (error || !rider) {
      return ctx.reply("❌ Invalid code. Please check with your admin.");
    }

    // Update rider's Telegram ID
    await supabase
      .from("riders")
      .update({ telegram_id: telegramId })
      .eq("id", rider.id);

    await ctx.reply(
      `✅ Account activated!\n👤 Name: ${rider.name}\n🏠 Campus: ${rider.campus}\n` +
        "You can now accept and deliver orders."
    );
  });

  // ==================== Accept Order ====================
  bot.action(/^accept_order_(\d+)$/, async (ctx: Context & any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (!rider) return ctx.reply("⚠️ You are not registered as a rider.");

    const orderId = Number(ctx.update.callback_query.data.split("_")[2]);
    const { error } = await supabase
      .from("orders")
      .update({ status: "accepted", assigned_rider: telegramId })
      .eq("id", orderId);

    if (error) return ctx.reply("⚠️ Failed to accept order.");

    await ctx.editMessageText(
      "✅ You accepted this order. Preparing delivery..."
    );

    // Notify admins
    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚴 Rider @${
          ctx.from.username || ctx.from.first_name
        } accepted order #${orderId}.`
      );
    }
  });

  // ==================== Reject Order ====================
  bot.action(/^reject_order_(\d+)$/, async (ctx: Context & any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (!rider) return ctx.reply("⚠️ You are not registered as a rider.");

    const orderId = Number(ctx.update.callback_query.data.split("_")[2]);
    const { error } = await supabase
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", orderId);

    if (error) return ctx.reply("⚠️ Failed to reject order.");

    await ctx.editMessageText(
      "❌ You rejected this order. Admin will reassign it."
    );

    // Notify admins
    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `⚠️ Order #${orderId} was rejected by rider @${
          ctx.from.username || ctx.from.first_name
        }. Needs reassignment.`
      );
    }
  });
}
