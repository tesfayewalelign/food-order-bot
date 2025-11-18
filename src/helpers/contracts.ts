import { supabase } from "../config/supabase.js";

export async function getUserContract(userId: number) {
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .gt("remaining_orders", 0)
    .maybeSingle();

  if (error) {
    console.error("Contract fetch error:", error);
    return null;
  }

  return contract || null;
}
