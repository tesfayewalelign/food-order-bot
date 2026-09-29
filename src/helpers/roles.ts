import { db } from "../config/db.js";

export type UserRole = "admin" | "rider" | "customer";

export const getAdminIds = (): number[] => {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !isNaN(id));
};

export async function getUserRole(userId: number): Promise<UserRole> {
  // 1. Admin priority
  const adminIds = getAdminIds();
  if (adminIds.includes(userId)) {
    return "admin";
  }

  // 2. Rider priority (Telegram ID linked to an activated rider record)
  try {
    const res = await db.execute({
      sql: "SELECT id FROM riders WHERE telegram_id = ? AND active = 1",
      args: [userId],
    });
    if (res.rows.length > 0) {
      return "rider";
    }
  } catch (err) {
    console.error("getUserRole rider check error:", err);
  }

  // 3. Customer default
  return "customer";
}

export async function requireAdmin(ctx: any): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  const role = await getUserRole(userId);
  if (role !== "admin") {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("🚫 You are not authorized to use this feature.", { show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("🚫 You are not authorized to use this feature.");
    }
    return false;
  }
  return true;
}

export async function requireRider(ctx: any): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  const role = await getUserRole(userId);
  if (role !== "rider" && role !== "admin") {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("🚫 This feature is available only to riders.", { show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("🚫 This feature is available only to riders.");
    }
    return false;
  }
  return true;
}
