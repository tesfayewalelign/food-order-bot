import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../config/db.js";
import { getSpecialOrderRiderKeyboard } from "./specialOrderKeyboards.js";

function escapeHTML(str?: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

function formatPhoneLinkHTML(phone?: string): string {
  if (!phone) return "N/A";
  const raw = phone.trim();
  const tel = normalizePhone(raw);
  if (tel) {
    return `<a href="tel:${tel}">${escapeHTML(raw)}</a>`;
  }
  return escapeHTML(raw);
}

function formatCampusName(campus?: string): string {
  if (!campus) return "N/A";
  return campus
    .replace(/^campus_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function notifyAdminsNewSpecialOrder(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  orderId: number
) {
  try {
    const orderRes = await db.execute({
      sql: "SELECT * FROM special_orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];
    if (!order) return;

    const itemsRes = await db.execute({
      sql: "SELECT * FROM special_order_items WHERE special_order_id = ?",
      args: [orderId],
    });
    const items = itemsRes.rows;

    const itemsList = items
      .map((i: any) => {
        const p = i.customer_price !== null && i.customer_price !== undefined ? `${i.customer_price} ETB` : "Unknown";
        return `• ${escapeHTML(String(i.item_name))} × ${i.quantity} — ${p}`;
      })
      .join("\n");

    const msgHtml =
      `⭐ <b>SPECIAL ORDER #${order.id}</b>\n\n` +
      `👤 <b>Customer:</b> ${escapeHTML(String(order.user_name))}\n` +
      `📞 <b>Phone:</b> ${formatPhoneLinkHTML(String(order.phone))}\n` +
      `🏫 <b>Delivery:</b> ${escapeHTML(formatCampusName(String(order.campus)))}\n\n` +
      `🏪 <b>Restaurant:</b> ${escapeHTML(String(order.restaurant_name))}\n` +
      `📍 <b>Restaurant Location:</b> ${escapeHTML(String(order.restaurant_location))}\n\n` +
      `🍔 <b>Items:</b>\n${itemsList}\n\n` +
      `📦 <b>Status:</b> Waiting for Review`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🔍 Review Special Order", `so_admin_view_${order.id}`)],
    ]);

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, msgHtml, {
          parse_mode: "HTML",
          reply_markup: keyboard.reply_markup,
        });
      } catch (err) {
        console.error(`[SpecialOrderNotify] Failed sending notification to admin ${adminId}:`, err);
      }
    }
  } catch (err) {
    console.error("[SpecialOrderNotify] Error in notifyAdminsNewSpecialOrder:", err);
  }
}

export async function broadcastSpecialOrderToRiders(
  bot: Telegraf<Context>,
  orderId: number
) {
  try {
    const orderRes = await db.execute({
      sql: "SELECT * FROM special_orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];
    if (!order || order.status !== "ready_for_delivery") return;

    const itemsRes = await db.execute({
      sql: "SELECT * FROM special_order_items WHERE special_order_id = ?",
      args: [orderId],
    });
    const items = itemsRes.rows;

    const itemsList = items
      .map((i: any) => `• ${escapeHTML(String(i.item_name))} × ${i.quantity}`)
      .join("\n");

    const phoneLink = formatPhoneLinkHTML(String(order.phone));

    const msgHtml =
      `⭐ <b>SPECIAL DELIVERY #${order.id}</b>\n\n` +
      `👤 <b>Customer:</b> ${escapeHTML(String(order.user_name))}\n` +
      `📞 <b>Phone:</b> ${phoneLink}\n` +
      `🏫 <b>Delivery:</b> ${escapeHTML(formatCampusName(String(order.campus)))}\n\n` +
      `🏪 <b>Restaurant:</b> ${escapeHTML(String(order.restaurant_name))}\n` +
      `📍 <b>Restaurant Location:</b> ${escapeHTML(String(order.restaurant_location))}\n\n` +
      `🍔 <b>Items:</b>\n${itemsList}\n\n` +
      `💰 <b>Total:</b> ${order.total_price} ETB`;

    const keyboard = getSpecialOrderRiderKeyboard(Number(order.id));

    // Get all active riders
    const ridersRes = await db.execute("SELECT telegram_id, campus FROM riders WHERE active = 1 AND telegram_id IS NOT NULL");
    const riders = ridersRes.rows;

    for (const r of riders) {
      if (!r.telegram_id) continue;
      try {
        await bot.telegram.sendMessage(Number(r.telegram_id), msgHtml, {
          parse_mode: "HTML",
          reply_markup: keyboard.reply_markup,
        });
      } catch (err) {
        console.error(`[SpecialOrderNotify] Failed sending broadcast to rider ${r.telegram_id}:`, err);
      }
    }
  } catch (err) {
    console.error("[SpecialOrderNotify] Error in broadcastSpecialOrderToRiders:", err);
  }
}
