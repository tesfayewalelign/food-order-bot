import { db } from "../config/db.js";
import { User } from "./state.js";

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim());

const MENU_BUTTON_STRINGS = new Set([
  "🍽️ Order Food",
  "🍔 Order Food",
  "📦 My Orders",
  "⭐ Special Order",
  "⭐ Favorite Orders",
  "❓ Help",
  "ℹ️ Help",
  "👤 My Profile",
  "📞 Contact Us",
  "💬 Complaint",
  "🏠 Main Menu",
  "📦 My Deliveries",
  "🛵 New Orders",
  "📅 My Schedule",
  "📊 Dashboard",
  "🍽 Restaurants",
  "🍔 Foods",
  "🛵 Riders",
  "📋 Orders",
  "🚚 Delivery Pricing",
  "📥 Contract Requests",
  "💬 Complaints",
  "⚙️ Settings",
]);

export function isValidCustomerName(name?: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (trimmed.startsWith("/")) return false;
  if (MENU_BUTTON_STRINGS.has(trimmed)) return false;
  // Must contain at least one letter (Unicode letters, including Amharic / Ge'ez)
  if (!/[\p{L}]/u.test(trimmed)) return false;
  return true;
}

export function isValidPhoneNumber(phone?: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\(\)]/g, "").trim();
  if (MENU_BUTTON_STRINGS.has(cleaned)) return false;
  // Ethiopian phone patterns: +251..., 09..., 07..., 251... or standard E.164 (+1..., etc.)
  if (/^(\+251|251|0)?[79]\d{8}$/.test(cleaned)) return true;
  if (/^\+[1-9]\d{8,14}$/.test(cleaned)) return true;
  return false;
}

export function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, "").trim();
  if (cleaned.startsWith("09")) {
    cleaned = "+2519" + cleaned.slice(2);
  } else if (cleaned.startsWith("07")) {
    cleaned = "+2517" + cleaned.slice(2);
  } else if (cleaned.startsWith("251")) {
    cleaned = "+" + cleaned;
  } else if (/^[79]\d{8}$/.test(cleaned)) {
    cleaned = "+251" + cleaned;
  }
  return cleaned;
}

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(String(userId));
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  const result = await db.execute({
    sql: "SELECT * FROM profiles WHERE phone = ?",
    args: [phone],
  });
  return (result.rows[0] as unknown as User) || null;
}
