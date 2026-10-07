import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";
import { requireRider, getUserRole } from "../../helpers/roles.js";
import {
  riderMenuKeyboard,
  customerMenuKeyboard,
  adminReplyKeyboard,
} from "../../helpers/keyboards.js";

function escapeMarkdown(str?: string): string {
  if (!str) return "";
  return str.replace(/[_*`\[\]]/g, "\\$&");
}

function escapeHTML(str?: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeCampusKey(campus?: string): string {
  if (!campus) return "";
  return String(campus)
    .replace(/^campus_/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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

function formatPhoneLink(phone?: string): string {
  if (!phone) return "N/A";
  return phone.trim();
}

function formatCampusName(campus?: string): string {
  if (!campus) return "N/A";
  return campus
    .replace(/^campus_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function setupDriverHandler(bot: Telegraf<Context>) {
  // Hears handlers with role guards
  bot.hears("📦 My Deliveries", async (ctx) => {
    if (!(await requireRider(ctx))) return;
    await handleMyDeliveries(ctx);
  });

  bot.hears("🛵 New Orders", async (ctx) => {
    if (!(await requireRider(ctx))) return;
    await handleNewOrders(ctx);
  });

  bot.hears("📅 My Schedule", async (ctx) => {
    if (!(await requireRider(ctx))) return;
    await handleSchedule(ctx);
  });

  bot.hears("📅 Schedule", async (ctx) => {
    if (!(await requireRider(ctx))) return;
    await handleSchedule(ctx);
  });

  bot.hears("👤 My Profile", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    const role = await getUserRole(userId);
    if (role === "rider") {
      return handleRiderProfile(ctx);
    }
    return next();
  });

  bot.hears("🏠 Main Menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const role = await getUserRole(userId);

    if (role === "admin") {
      return ctx.reply("🏠 *Admin Main Menu*", {
        parse_mode: "Markdown",
        ...adminReplyKeyboard,
      });
    }

    if (role === "rider") {
      return ctx.reply("🏠 *Rider Main Menu*", {
        parse_mode: "Markdown",
        ...riderMenuKeyboard,
      });
    }

    return ctx.reply("🏠 *Main Menu*", {
      parse_mode: "Markdown",
      ...customerMenuKeyboard,
    });
  });

  async function handleRiderProfile(ctx: Context) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const res = await db.execute({
      sql: "SELECT * FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = res.rows[0];

    if (!rider) {
      return ctx.reply("⚠️ You do not have an active rider profile.");
    }

    const profileMsg =
      `👤 *Rider Profile*\n\n` +
      `🛵 *Name:* ${rider.name}\n` +
      `📞 *Phone:* ${formatPhoneLink(String(rider.phone))}\n` +
      `🏫 *Assigned Campus:* ${formatCampusName(String(rider.campus))}\n` +
      `🟢 *Status:* Active Rider`;

    return ctx.reply(profileMsg, { parse_mode: "Markdown" });
  }

  async function handleSchedule(ctx: Context) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const res = await db.execute({
      sql: "SELECT name, campus FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = res.rows[0];

    const campusLabel = rider ? formatCampusName(String(rider.campus)) : "Assigned Campus";

    return ctx.reply(
      `📅 *My Schedule*\n\n` +
        `🕘 *Hours:* 9:00 AM – 9:00 PM\n` +
        `🏫 *Assigned Zone:* ${campusLabel}\n` +
        `⚡ *Shift Status:* Active`,
      { parse_mode: "Markdown" }
    );
  }

  async function handleNewOrders(ctx: Context) {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      const riderRes = await db.execute({
        sql: "SELECT * FROM riders WHERE telegram_id = ? AND active = 1",
        args: [telegramId],
      });
      const rider = riderRes.rows[0];

      if (!rider) {
        return ctx.reply("⚠️ You are not an activated rider.");
      }

      const pendingOrdersRes = await db.execute({
        sql: "SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC LIMIT 20",
        args: [],
      });
      const pendingOrders = pendingOrdersRes.rows;

      if (pendingOrders.length === 0) {
        return ctx.reply("🛵 <b>No new pending orders at this time.</b>", { parse_mode: "HTML" });
      }

      // Prioritize orders matching rider's campus
      const riderNormCampus = normalizeCampusKey(String(rider.campus || ""));
      let matchingOrders = pendingOrders.filter((o: any) => {
        const orderNorm = normalizeCampusKey(String(o.campus || ""));
        return (
          riderNormCampus === orderNorm ||
          riderNormCampus.includes(orderNorm) ||
          orderNorm.includes(riderNormCampus)
        );
      });

      // If no order matches rider's specific campus, display all pending orders so no orders are missed
      if (matchingOrders.length === 0) {
        matchingOrders = pendingOrders;
      }

      for (const o of matchingOrders) {
        const telLink = formatPhoneLink(String(o.phone));
        const formattedItems = String(o.foods_summary || "")
          .split(",")
          .map((i) => `• ${escapeHTML(i.trim())}`)
          .join("\n");

        const msgText =
          `🛵 <b>New Order #${o.id}</b>\n\n` +
          `👤 <b>Customer:</b> ${escapeHTML(String(o.user_name))}\n` +
          `📞 <b>Phone:</b> ${escapeHTML(telLink)}\n` +
          `🏫 <b>Campus:</b> ${escapeHTML(formatCampusName(String(o.campus)))}\n` +
          `🍴 <b>Restaurant:</b> ${escapeHTML(String(o.restaurant))}\n\n` +
          `🍱 <b>Order Summary:</b>\n${formattedItems}\n\n` +
          `🍽️ <b>Food Contract:</b> ${o.has_restaurant_contract ? "Yes" : "No"}\n` +
          `🚚 <b>Delivery Contract:</b> ${o.has_delivery_contract ? "Yes" : "No"}\n\n` +
          `💰 <b>Total:</b> ${o.total_price} ETB`;

        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Accept Order", `accept_order_${o.id}`),
            Markup.button.callback("❌ Reject", `reject_order_${o.id}`),
          ],
        ]);

        try {
          await ctx.reply(msgText, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup,
          });
        } catch (sendErr) {
          console.error(`⚠️ Failed sending HTML new order #${o.id} reply, falling back to plain text:`, sendErr);
          const plain = msgText.replace(/<[^>]+>/g, "");
          await ctx.reply(plain, {
            reply_markup: keyboard.reply_markup,
          });
        }
      }
    } catch (err) {
      console.error("❌ Error in handleNewOrders:", err);
      await ctx.reply("⚠️ An unexpected error occurred while loading new orders. Please try again.");
    }
  }

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
      sql: "SELECT * FROM orders WHERE rider_id = ? ORDER BY id DESC LIMIT 20",
      args: [Number(rider.id)],
    });
    const orders = ordersRes.rows;

    if (orders.length === 0) {
      return ctx.reply("📦 No deliveries assigned to you yet.");
    }

    // Split orders into Today vs Previous
    const todayStr = new Date().toISOString().split("T")[0];
    const todayOrders: any[] = [];
    const previousOrders: any[] = [];

    orders.forEach((o: any) => {
      const orderDateStr = o.created_at ? new Date(o.created_at).toISOString().split("T")[0] : "";
      if (orderDateStr === todayStr) {
        todayOrders.push(o);
      } else {
        previousOrders.push(o);
      }
    });

    let message = `📦 *My Deliveries*\n\n`;

    if (todayOrders.length > 0) {
      message += `### *Today*\n\n`;
      todayOrders.forEach((o: any) => {
        const icon =
          o.status === "delivered"
            ? "🟢"
            : o.status === "accepted" || o.status === "on_the_way" || o.status === "picked_up"
            ? "🟡"
            : "⚪";
        message += `${icon} *Order #${o.id}*\n`;
        message += `Customer: ${o.user_name}\n`;
        message += `Campus: ${formatCampusName(String(o.campus))}\n`;
        message += `Status: *${formatStatusLabel(o.status)}*\n\n`;
      });
    }

    if (previousOrders.length > 0) {
      message += `### *Previous*\n\n`;
      previousOrders.forEach((o: any) => {
        const icon = o.status === "delivered" ? "🟢" : "⚪";
        message += `${icon} *Order #${o.id}* — ${o.user_name} (${formatCampusName(String(o.campus))}) | Status: ${formatStatusLabel(o.status)}\n`;
      });
    }

    await ctx.reply(message, { parse_mode: "Markdown" });

    // For active orders, offer status control buttons
    const activeOrders = orders.filter(
      (o: any) => o.status === "accepted" || o.status === "on_the_way" || o.status === "picked_up"
    );

    for (const o of activeOrders) {
      let actionBtn;
      if (o.status === "accepted") {
        actionBtn = Markup.button.callback("🚶 On the Way", `status_ontheway_${o.id}`);
      } else if (o.status === "on_the_way") {
        actionBtn = Markup.button.callback("📦 Picked Up", `status_pickedup_${o.id}`);
      } else if (o.status === "picked_up") {
        actionBtn = Markup.button.callback("✅ Delivered", `status_delivered_${o.id}`);
      }

      if (actionBtn) {
        await ctx.reply(
          `🛵 *Update Order #${o.id}* (${o.user_name} - ${formatStatusLabel(String(o.status || ""))}):`,
          {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([[actionBtn]]).reply_markup,
          }
        );
      }
    }
  }

  function formatStatusLabel(status?: string): string {
    switch (status) {
      case "pending":
        return "⏳ Pending";
      case "accepted":
        return "🚴 Accepted";
      case "on_the_way":
        return "🚶 On the Way";
      case "picked_up":
        return "📦 Picked Up";
      case "delivered":
        return "✅ Delivered";
      case "cancelled":
        return "❌ Cancelled";
      default:
        return status || "Unknown";
    }
  }

  // Accept Order Callback with Race Condition Guard (Requirement 5)
  bot.action(/^accept_order_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireRider(ctx))) return;

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

    // Requirement 5: Atomic UPDATE status='accepted' WHERE status='pending'
    const updateRes = await db.execute({
      sql: "UPDATE orders SET status = 'accepted', rider_id = ?, rider_name = ? WHERE id = ? AND status = 'pending'",
      args: [Number(rider.id), String(rider.name), orderId],
    });

    if (updateRes.rowsAffected === 0) {
      return ctx.editMessageText(
        `❌ *This order has already been accepted by another rider.*`,
        { parse_mode: "Markdown" }
      );
    }

    const orderRes = await db.execute({
      sql: "SELECT telegram_id, user_name FROM orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];

    // Requirement 8: Customer notification on acceptance
    if (order && order.telegram_id) {
      try {
        await ctx.telegram.sendMessage(
          Number(order.telegram_id),
          `🛵 *Your order has been accepted by a rider.*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    const nextKb = Markup.inlineKeyboard([
      [Markup.button.callback("🚶 On the Way", `status_ontheway_${orderId}`)],
    ]);

    await ctx.editMessageText(
      `✅ *Order #${orderId} Accepted!*\n\nYou are assigned to deliver this order.`,
      {
        parse_mode: "Markdown",
        reply_markup: nextKb.reply_markup,
      }
    );
  });

  bot.action(/^reject_order_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireRider(ctx))) return;
    const match = ctx.match;
    if (!match) return;

    const orderId = Number(match[1]);
    await ctx.editMessageText(`❌ *Order #${orderId} declined.*`, {
      parse_mode: "Markdown",
    });
  });

  // Delivery Lifecycle Status Transitions (Requirement 8)
  // Transition: accepted -> on_the_way
  bot.action(/^status_ontheway_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireRider(ctx))) return;

    const orderId = Number(ctx.match[1]);
    const telegramId = ctx.from!.id;

    const riderRes = await db.execute({
      sql: "SELECT id, name FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = riderRes.rows[0];

    if (!rider) return ctx.reply("⚠️ Unauthorized.");

    // Validate ownership & valid transition from 'accepted'
    const updateRes = await db.execute({
      sql: "UPDATE orders SET status = 'on_the_way' WHERE id = ? AND rider_id = ? AND status = 'accepted'",
      args: [orderId, Number(rider.id)],
    });

    if (updateRes.rowsAffected === 0) {
      return ctx.reply("⚠️ Cannot update status. Order must be accepted by you first.");
    }

    const orderRes = await db.execute({
      sql: "SELECT telegram_id FROM orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];

    if (order && order.telegram_id) {
      try {
        await ctx.telegram.sendMessage(
          Number(order.telegram_id),
          `🚶 *Your order is on the way.*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    const nextKb = Markup.inlineKeyboard([
      [Markup.button.callback("📦 Picked Up", `status_pickedup_${orderId}`)],
    ]);

    await ctx.editMessageText(
      `🚶 *Order #${orderId} is now marked as "On the Way".*`,
      {
        parse_mode: "Markdown",
        reply_markup: nextKb.reply_markup,
      }
    );
  });

  // Transition: on_the_way -> picked_up
  bot.action(/^status_pickedup_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireRider(ctx))) return;

    const orderId = Number(ctx.match[1]);
    const telegramId = ctx.from!.id;

    const riderRes = await db.execute({
      sql: "SELECT id, name FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = riderRes.rows[0];

    if (!rider) return ctx.reply("⚠️ Unauthorized.");

    const updateRes = await db.execute({
      sql: "UPDATE orders SET status = 'picked_up' WHERE id = ? AND rider_id = ? AND status = 'on_the_way'",
      args: [orderId, Number(rider.id)],
    });

    if (updateRes.rowsAffected === 0) {
      return ctx.reply("⚠️ Cannot update status. Order status must be 'On the Way'.");
    }

    const orderRes = await db.execute({
      sql: "SELECT telegram_id FROM orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];

    if (order && order.telegram_id) {
      try {
        await ctx.telegram.sendMessage(
          Number(order.telegram_id),
          `📦 *Your food has been picked up.*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    const nextKb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Delivered", `status_delivered_${orderId}`)],
    ]);

    await ctx.editMessageText(
      `📦 *Order #${orderId} is now marked as "Picked Up".*`,
      {
        parse_mode: "Markdown",
        reply_markup: nextKb.reply_markup,
      }
    );
  });

  // Transition: picked_up -> delivered
  bot.action(/^status_delivered_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireRider(ctx))) return;

    const orderId = Number(ctx.match[1]);
    const telegramId = ctx.from!.id;

    const riderRes = await db.execute({
      sql: "SELECT id, name FROM riders WHERE telegram_id = ? AND active = 1",
      args: [telegramId],
    });
    const rider = riderRes.rows[0];

    if (!rider) return ctx.reply("⚠️ Unauthorized.");

    const updateRes = await db.execute({
      sql: "UPDATE orders SET status = 'delivered' WHERE id = ? AND rider_id = ? AND status = 'picked_up'",
      args: [orderId, Number(rider.id)],
    });

    if (updateRes.rowsAffected === 0) {
      return ctx.reply("⚠️ Cannot update status. Order status must be 'Picked Up'.");
    }

    const orderRes = await db.execute({
      sql: "SELECT telegram_id FROM orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];

    if (order && order.telegram_id) {
      try {
        await ctx.telegram.sendMessage(
          Number(order.telegram_id),
          `✅ *Your order has been delivered.*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    await ctx.editMessageText(
      `✅ *Order #${orderId} is now marked as "Delivered"!*`,
      { parse_mode: "Markdown" }
    );
  });
}
