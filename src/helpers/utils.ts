import { supabase } from "../config/supabase.js";
import { User } from "./state.js";

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => id.trim());

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(String(userId));
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (error) throw error;
  return data as User | null;
}

export type NewUser = Omit<User, "id" | "created_at">;

export async function createUser(userData: NewUser): Promise<User> {
  const { data, error } = await supabase
    .from("users")
    .insert([userData])
    .select("*")
    .single();

  if (error) throw error;
  return data as User;
}

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

export async function decrementContract(
  phone: string
): Promise<number | false> {
  const { data, error } = await supabase
    .from("users")
    .select("remaining_contract")
    .eq("phone", phone)
    .single();

  if (error) throw error;

  const user = data as Pick<User, "remaining_contract"> | null;

  if (!user || !user.remaining_contract || user.remaining_contract <= 0)
    return false;

  const newRemaining = user.remaining_contract - 1;

  await supabase
    .from("users")
    .update({ remaining_contract: newRemaining })
    .eq("phone", phone);

  return newRemaining;
}

export async function resetContract(phone: string, count = 30): Promise<void> {
  await supabase
    .from("users")
    .update({ remaining_contract: count })
    .eq("phone", phone);
}
