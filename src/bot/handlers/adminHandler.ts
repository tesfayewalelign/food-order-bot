import { Telegraf, Markup, Context } from "telegraf";
import { supabase } from "../../config/supabase.js";

export function setupAdminHandler(bot: Telegraf, ADMIN_IDS: number[]) {
  bot.command("add_rider", async (ctx: Context) => {
    const userId = ctx.from?.id;

    if (!userId || !ADMIN_IDS.includes(userId)) {
      return ctx.reply("🚫 You are not authorized to add riders.");
    }

    if (!ctx.message || !("text" in ctx.message)) {
      return ctx.reply("⚠️ Send text only.");
    }

    const text = ctx.message.text.trim();
    const match = text.match(/^\/add_rider\s+(\d+)\s+(\S+)\s+"([^"]+)"$/);

    if (!match) {
      return ctx.reply(
        `⚠️ Wrong format.\nUse:\n/add_rider 0953717736 Besukal "Techno Boys Dorm"`
      );
    }

    const [, phone, name, campus] = match;

    const { error } = await supabase.from("riders").insert([
      {
        name,
        phone,
        campus,
        telegram_id: phone,
        active: true,
      },
    ]);

    if (error) {
      console.error(error);
      return ctx.reply("❌ Failed to add rider.");
    }

    return ctx.reply(
      `✅ Rider Added Successfully\n👤 Name: ${name}\n📞 Phone: ${phone}\n🏫 Campus: ${campus}`
    );
  });

  bot.command("orders", async (ctx) => {
    const userId = ctx.from?.id;
    if (!ADMIN_IDS.includes(userId!)) {
      return ctx.reply("🚫 You are not authorized to view orders.");
    }

    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error(error);
      return ctx.reply("⚠️ Failed to fetch orders from database.");
    }

    if (!orders || orders.length === 0) {
      return ctx.reply("📭 No orders found yet.");
    }

    for (const order of orders) {
      await ctx.replyWithMarkdown(
        `🧾 *Order #${order.id}*\n` +
          `👤 Name: ${order.user_name}\n` +
          `📞 Phone: ${order.phone}\n` +
          `🏫 Campus: ${order.campus}\n` +
          `🍽 Restaurant: ${order.restaurant}\n` +
          `🍔 Foods: ${order.foods}\n` +
          `💰 Total: ${order.total} ETB\n` +
          `🚚 Delivery Type: ${
            order.delivery_type === "contract"
              ? `📦 Remaining Contracts: ${order.remaining_contracts}`
              : "Pay on Delivery"
          }\n` +
          `📦 Status: ${
            order.status === "accepted"
              ? "✅ Accepted"
              : order.status === "rejected"
              ? "❌ Rejected"
              : order.status === "delivered"
              ? "📦 Delivered"
              : "🕒 Pending"
          }`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Mark Delivered",
              `mark_delivered_${order.id}`
            ),
            Markup.button.callback("❌ Cancel", `cancel_order_${order.id}`),
          ],
        ])
      );
    }
  });

  bot.action(/^mark_delivered_(\d+)$/, async (ctx) => {
    const orderId = Number(ctx.match[1]);

    const { error } = await supabase
      .from("orders")
      .update({ status: "delivered" })
      .eq("id", orderId);

    if (error) {
      console.error(error);
      return ctx.reply("⚠️ Failed to mark as delivered.");
    }

    await ctx.editMessageText(`📦 Order #${orderId} marked as delivered!`);
  });

  bot.action(/^cancel_order_(\d+)$/, async (ctx) => {
    const orderId = Number(ctx.match[1]);

    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId);

    if (error) {
      console.error(error);
      return ctx.reply("⚠️ Failed to cancel order.");
    }

    await ctx.editMessageText(`❌ Order #${orderId} cancelled.`);
  });
}
