import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";

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

function normalizePhone(phone?: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("09")) {
    cleaned = "+2519" + cleaned.slice(2);
  } else if (cleaned.startsWith("07")) {
    cleaned = "+2517" + cleaned.slice(2);
  } else if (cleaned.startsWith("251")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

export function setupDriverHandler(bot: Telegraf<Context>) {
  bot.hears("📦 My Deliveries", handleMyDeliveries);
  bot.hears("📅 Schedule", handleSchedule);
  bot.hears("🏠 Main Menu", handleMainMenu);

  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const res = await db.execute({
      sql: "SELECT * FROM riders WHERE telegram_id = ? AND active = 1",
      args: [userId],
    });
    const rider = res.rows[0];

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
  });

  async function handleMyDeliveries(ctx: Context) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const res = await db.execute({
      sql: "SELECT id, name FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = res.rows[0];

    if (!rider) {
      return ctx.reply("⚠️ You are not activated.");
    }

    const ordersRes = await db.execute({
      sql: "SELECT id, user_name, phone, total_price, created_at FROM orders WHERE rider_id = ? ORDER BY id DESC LIMIT 20",
      args: [Number(rider.id)],
    });
    const orders = ordersRes.rows;

    if (orders.length === 0) {
      return ctx.reply("📦 No deliveries assigned to you yet.");
    }

    let message = `📦 *Your Deliveries*\n\n`;
    orders.forEach((o: any, i: number) => {
      const normPhone = normalizePhone(String(o.phone));
      const telLink = normPhone ? `[${o.phone}](tel:${normPhone})` : o.phone;
      message += `${i + 1}. *Order #${o.id}* — ${o.user_name} (📞 ${telLink})\nTotal: ${o.total_price} ETB\n\n`;
    });

    return ctx.reply(message, { parse_mode: "Markdown" });
  }

  async function handleSchedule(ctx: Context) {
    return ctx.reply(
      "📅 *Your Schedule*\n\n🕘 9:00 AM – 9:00 PM\n📍 Campus Area",
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

  // Accept Order Callback with Race Condition Guard
  bot.action(/^accept_order_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const match = ctx.match;
    if (!match) return;

    const orderId = Number(match[1]);
    const telegramId = ctx.from!.id;

    const riderRes = await db.execute({
      sql: "SELECT id, name FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = riderRes.rows[0];

    if (!rider) {
      return ctx.reply("⚠️ You are not an activated rider.");
    }

    // Atomic UPDATE status='accepted' WHERE status='pending'
    const updateRes = await db.execute({
      sql: "UPDATE orders SET status = 'accepted', rider_id = ?, rider_name = ? WHERE id = ? AND status = 'pending'",
      args: [Number(rider.id), String(rider.name), orderId],
    });

    if (updateRes.rowsAffected === 0) {
      return ctx.editMessageText(
        `❌ *Order #${orderId} was already accepted by another rider.*`,
        { parse_mode: "Markdown" }
      );
    }

    const orderRes = await db.execute({
      sql: "SELECT telegram_id, user_name FROM orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];

    if (order && order.telegram_id) {
      try {
        await ctx.telegram.sendMessage(
          Number(order.telegram_id),
          `🚴‍♂️ *Order Accepted!*\n\nRider *${rider.name}* has accepted your order #${orderId} and is on the way!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    await ctx.editMessageText(
      `✅ *Order #${orderId} Accepted!*\n\nYou are assigned to deliver this order.`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action(/^reject_order_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const match = ctx.match;
    if (!match) return;

    const orderId = Number(match[1]);
    await ctx.editMessageText(`❌ *Order #${orderId} declined.*`, {
      parse_mode: "Markdown",
    });
  });

  bot.command("activate", async (ctx) => {
    if (!isTextMessage(ctx) || !ctx.from?.id) return;

    const match = ctx.message.text.trim().match(/^\/activate\s+(\d{4})$/);
    if (!match) return ctx.reply("⚠️ Please use: /activate <4-digit-code>");

    const code = match[1];

    const riderRes = await db.execute({
      sql: "SELECT * FROM riders WHERE secret_code = ?",
      args: [String(code || "")],
    });
    const rider = riderRes.rows[0];

    if (!rider) return ctx.reply("❌ Invalid secret code.");

    await db.execute({
      sql: "UPDATE riders SET telegram_id = ? WHERE id = ?",
      args: [ctx.from.id, Number(rider.id)],
    });

    ctx.reply(
      `✅ Rider activated! Welcome ${rider.name}!\nChoose an option:`,
      Markup.keyboard([
        ["📦 My Deliveries"],
        ["📅 Schedule"],
        ["🏠 Main Menu"],
      ]).resize()
    );
  });
}
