import { userState } from "../../helpers/state.js";
import { supabase } from "../../config/supabase.js";
import { confirmKeyboard } from "../../helpers/keyboards.js";

export function setupDriverHandler(bot: any, DRIVER_IDS: number[]) {
  bot.hears("📦 My Orders", async (ctx: any) => {
    const tid = ctx.from?.id!;
    if (!DRIVER_IDS.includes(tid)) return;
    const { data: orders } = await supabase
      .from("orders")
      .select(
        `
        id, status,
        users(name, phone, campus),
        restaurants(name)
      `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (!orders || orders.length === 0)
      return ctx.reply("⚠️ No pending orders.");
    userState.set(tid, { step: "driver_select_order", cartFoods: orders });
    const buttons = orders.map(
      (o: any) => `Order ${o.id} - ${o.restaurants.name}`
    );
    return ctx.reply("📋 Pending Orders:", confirmKeyboard);
  });
}
