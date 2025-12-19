import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

const ADMIN_IDS: number[] = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id))
  .filter((id) => !isNaN(id));

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
  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", userId)
      .maybeSingle();

    if (rider) {
      return ctx.reply(
        `🚗 Welcome back, ${rider.name}!\nChoose an option:`,
        Markup.keyboard([
          ["📦 My Deliveries"],
          ["📅 Schedule"],
          ["🏠 Main Menu"],
        ]).resize()
      );
    } else {
      return ctx.reply(
        "🛵 Welcome Rider!\nPlease activate your account with the code sent by admin:\n/activate <4-digit-code>"
      );
    }

    bot.hears("📦 My Deliveries", handleMyDeliveries);
    bot.hears("📅 Schedule", handleSchedule);
    bot.hears("🏠 Main Menu", handleMainMenu);
  });
  async function handleMyDeliveries(ctx: Context) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: rider } = await supabase
      .from("riders")
      .select("id, name")
      .eq("telegram_id", telegramId)
      .single();

    if (!rider) {
      return ctx.reply("⚠️ You are not activated.");
    }

    const since = new Date();
    since.setHours(since.getHours() - 24);

    const { data: orders } = await supabase
      .from("orders")
      .select("id, delivered_at")
      .eq("rider_id", rider.id)
      .eq("status", "delivered")
      .gte("delivered_at", since.toISOString())
      .order("delivered_at", { ascending: false });

    if (!orders || orders.length === 0) {
      return ctx.reply("📦 No deliveries in the last 24 hours.");
    }

    let message = `📦 *Your Deliveries (Last 24 Hours)*\n\n`;
    orders.forEach((o, i) => {
      message += `${i + 1}. Order #${o.id}\n`;
    });

    message += `\n✅ Total Delivered: *${orders.length}*`;

    return ctx.reply(message, { parse_mode: "Markdown" });
  }

  async function handleSchedule(ctx: Context) {
    return ctx.reply(
      "📅 *Your Schedule*\n\n🕘 9:00 AM – 6:00 PM\n📍 Campus Area",
      { parse_mode: "Markdown" }
    );
  }

  async function handleMainMenu(ctx: Context) {
    return ctx.reply(
      "🏠 Main Menu",
      Markup.keyboard([
        ["📦 My Deliveries"],
        ["📅 Schedule"],
        ["🏠 Main Menu"],
      ]).resize()
    );
  }

  bot.command("activate", async (ctx) => {
    if (!isTextMessage(ctx) || !ctx.from?.id) return;

    const match = ctx.message.text.trim().match(/^\/activate\s+(\d{4})$/);
    if (!match) return ctx.reply("⚠️ Please use: /activate <4-digit-code>");

    const code = match[1];

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("secret_code", code)
      .maybeSingle();

    if (!rider) return ctx.reply("❌ Invalid secret code.");

    await supabase
      .from("riders")
      .update({ telegram_id: ctx.from.id })
      .eq("id", rider.id);

    ctx.reply(
      `✅ Rider activated! Welcome ${rider.name}!\nChoose an option:`,
      Markup.keyboard([
        ["📦 My Deliveries"],
        ["📅 Schedule"],
        ["🏠 Main Menu"],
      ]).resize()
    );
  });

  bot.command("my_orders", async (ctx) => {
    if (!ctx.from?.id) return;

    const riderId = ctx.from.id;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("telegram_id", riderId)
      .maybeSingle();

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
  });

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
      .maybeSingle();

    if (!rider)
      return ctx.reply("⚠️ You are not activated. Use /activate <code>");

    await supabase
      .from("orders")
      .update({ status: "Accepted", rider_id: rider.id })
      .eq("id", orderId);

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
      .maybeSingle();

    if (!rider)
      return ctx.reply("⚠️ You are not activated. Use /activate <code>");

    await supabase
      .from("orders")
      .update({ status: "Rejected" })
      .eq("id", orderId);

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

  bot.action(/rider_order_approve_(\d+)/, async (ctx) => {
    const orderUserId = ctx.match[1];

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("id, name")
      .eq("telegram_id", ctx.from!.id)
      .single();

    if (riderError || !rider)
      return ctx.answerCbQuery("❌ Rider not found in database");

    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "approved", assigned_rider: rider.id })
      .eq("id", orderUserId)
      .select()
      .single();

    if (error || !order) return ctx.answerCbQuery("❌ Error approving order");

    if (order.telegram_id) {
      await ctx.telegram.sendMessage(
        order.telegram_id,
        `✅ Your order has been approved! Rider ${ctx.from?.first_name} is on the way 🚴‍♂️`
      );
    }

    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚴‍♂️ Rider *${ctx.from?.first_name}* approved order of ${order.user_name}`,
        { parse_mode: "Markdown" }
      );
    }

    await ctx.answerCbQuery("Order approved!");
    await ctx.editMessageReplyMarkup(undefined);
  });

  bot.action(/rider_order_reject_(\d+)/, async (ctx) => {
    const orderUserId = ctx.match[1];

    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", orderUserId)
      .select()
      .single();

    if (error || !order) return ctx.answerCbQuery("❌ Error rejecting order");

    for (const adminId of ADMIN_IDS) {
      await ctx.telegram.sendMessage(
        adminId,
        `❌ Rider *${ctx.from?.first_name}* rejected order of ${order.user_name}`,
        { parse_mode: "Markdown" }
      );
    }

    await ctx.answerCbQuery("Order rejected");
    await ctx.editMessageReplyMarkup(undefined);
  });
}
