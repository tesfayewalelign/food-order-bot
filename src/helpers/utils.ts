import { db } from "../config/db.js";
import { User } from "./state.js";

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim());

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
