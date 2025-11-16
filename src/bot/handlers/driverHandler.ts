import { Telegraf, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";

function isTextMessage(
  ctx: Context
): ctx is Context & { message: { text: string } } {
  return (
    !!ctx.message &&
    "text" in ctx.message &&
    typeof ctx.message.text === "string"
  );
}

export function setupDriverHandler(bot: Telegraf<Context>) {
  bot.command("activate", async (ctx) => {
    if (!isTextMessage(ctx)) return;

    const match = ctx.message.text.trim().match(/^\/activate\s+(\d{4})$/);
    if (!match) return ctx.reply("⚠️ Please use: /activate <4-digit-code>");

    const code = match[1];

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("secret_code", code)
      .single();

    if (!rider) return ctx.reply("❌ Invalid secret code.");

    await supabase
      .from("riders")
      .update({ telegram_id: ctx.from?.id })
      .eq("id", rider.id);

    ctx.reply(`✅ Rider activated! Welcome ${rider.name}`);
  });

  async function sendPendingOrders(ctx: Context & { from: { id: number } }) {
    const riderId = ctx.from.id;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", riderId)
      .single();

    if (!rider)
      return ctx.reply("⚠️ You are not activated. Use /activate <code>");

    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("campus", rider.campus)
      .eq("status", "pending")
      .order("id");

    if (!orders || orders.length === 0)
      return ctx.reply("📭 No new orders available.");

    let text = "📦 Pending Orders:\n";

    for (const o of orders) {
      text += `\nID: ${o.id} | User: ${o.user_name} | Phone: ${o.phone} | Foods: ${o.foods}`;
      text += `\n/accept ${o.id} - Accept | /reject ${o.id} - Reject\n`;
    }

    ctx.reply(text);
  }

  bot.command("my_orders", sendPendingOrders);

  bot.command("accept", async (ctx) => {
    if (!isTextMessage(ctx) || !ctx.from?.id) return;

    const match = ctx.message.text.trim().match(/^\/accept\s+(\d+)$/);
    if (!match) return ctx.reply("⚠️ Use: /accept <order-id>");

    const orderId = Number(match[1]);
    const riderId = ctx.from.id;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", riderId)
      .single();

    if (!rider)
      return ctx.reply("⚠️ You are not activated. Use /activate <code>");

    const { error } = await supabase
      .from("orders")
      .update({ status: "Accepted", rider_id: rider.id })
      .eq("id", orderId);

    if (error) return ctx.reply("❌ Failed to accept order.");

    ctx.reply(`✅ Order #${orderId} accepted!`);
  });

  bot.command("reject", async (ctx) => {
    if (!isTextMessage(ctx) || !ctx.from?.id) return;

    const match = ctx.message.text.trim().match(/^\/reject\s+(\d+)$/);
    if (!match) return ctx.reply("⚠️ Use: /reject <order-id>");

    const orderId = Number(match[1]);
    const riderId = ctx.from.id;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", riderId)
      .single();

    if (!rider)
      return ctx.reply("⚠️ You are not activated. Use /activate <code>");

    const { error } = await supabase
      .from("orders")
      .update({ status: "Rejected" })
      .eq("id", orderId);

    if (error) return ctx.reply("❌ Failed to reject order.");

    ctx.reply(`❌ Order #${orderId} rejected.`);
  });

  bot.command("rider_help", (ctx) => {
    ctx.reply(
      `🛵 Rider Commands:
/activate <4-digit-code>
/my_orders
/accept <order-id>
/reject <order-id>`
    );
  });
}
