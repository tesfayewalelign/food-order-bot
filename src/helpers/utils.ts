import { supabase } from "../config/supabase.js";
import { User } from "./state.js";

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim());

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(String(userId));
}

// ─── Get User by Phone ─────────────────────────
export async function getUserByPhone(phone: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (error) throw error;
  return data as User | null;
}

// ─── Type for New User ─────────────────────────
export type NewUser = Omit<User, "id" | "created_at">;

// ─── Create User ───────────────────────────────
export async function createUser(userData: NewUser): Promise<User> {
  const { data, error } = await supabase
    .from("users")
    .insert([userData])
    .select("*")
    .single();

  if (error) throw error;
  return data as User;
}

export async function upsertUserByTelegramId(
  telegram_id: number,
  state: Partial<NewUser & { deliveryType?: "new" | "contract" }>
): Promise<User | null> {
  try {
    // Prepare data for upsert
    const userData: Partial<User> = {
      telegram_id,
      phone: state.phone!,
      name: state.name!,
      campus: state.campus!,
      is_contract: state.deliveryType === "contract" || false,
      contract_count:
        state.deliveryType === "contract" ? 30 : state.contract_count ?? 0,
    };

    // Upsert user
    const { data, error } = await supabase
      .from("users")
      .upsert(userData, { onConflict: "telegram_id" }) // avoid duplicate key error
      .select("*")
      .maybeSingle();

    if (error) throw error;

    return data as User | null;
  } catch (err) {
    console.error("❌ Upsert user error:", err);
    return null;
  }
}
// ─── Update User ───────────────────────────────
export async function updateUser(
  phone: string,
  updates: Partial<Omit<User, "id" | "created_at">>
): Promise<User> {
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("phone", phone)
    .select("*")
    .single();

  if (error) throw error;
  return data as User;
}

// ─── Decrement Contract Count ──────────────────
export async function decrementContract(
  phone: string
): Promise<number | false> {
  const { data, error } = await supabase
    .from("users")
    .select("contract_count")
    .eq("phone", phone)
    .single();

  if (error) throw error;

  const user = data as Pick<User, "contract_count"> | null;

  if (!user || (user.contract_count ?? 0) <= 0) return false;

  const newCount = (user.contract_count ?? 0) - 1;

  await supabase
    .from("users")
    .update({ contract_count: newCount })
    .eq("phone", phone);

  return newCount;
}

// ─── Reset Contract Count ──────────────────────
export async function resetContract(phone: string, count = 30): Promise<void> {
  await supabase
    .from("users")
    .update({ contract_count: count })
    .eq("phone", phone);
}
