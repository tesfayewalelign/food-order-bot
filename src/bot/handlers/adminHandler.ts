import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

type AdminStateAction =
  | "add_restaurant"
  | "edit_restaurant"
  | "add_food"
  | "edit_food"
  | "add_rider"
  | "none";

interface AdminState {
  action?: AdminStateAction;
  restaurantId?: string | number | null;
  foodId?: string | number | null;
}

const adminStates = new Map<number, AdminState>();

function generateSecretCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function adminMainKeyboard() {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback("🍽 Restaurants", "admin_restaurants"),
      Markup.button.callback("🍔 Foods", "admin_foods"),
      Markup.button.callback("👤 Riders", "admin_riders"),
      Markup.button.callback("📋 Orders", "admin_orders"),
      Markup.button.callback("📦 Contracts", "admin_contracts"),
      Markup.button.callback("📥 Requests", "admin_contract_requests"),
      Markup.button.callback("📊 Dashboard", "admin_dashboard"),
    ],
    { columns: 2 }
  );
}

export function setupAdminHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  // ---------------- /admin command ----------------
  bot.command("admin", async (ctx) => {
    const id = ctx.from?.id;
    if (!id || !ADMIN_IDS.includes(id)) return ctx.reply("🚫 Not authorized.");
    await ctx.reply("*👋 Welcome to Admin Panel*", {
      parse_mode: "Markdown",
      ...adminMainKeyboard(),
    });
  });

  // ---------------- Admin action buttons ----------------
  bot.action(/.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    const action = ctx.match[0];

    // ---------------- BACK BUTTON ----------------
    if (action === "admin_back") {
      return ctx.editMessageText("*👋 Admin Panel*", {
        parse_mode: "Markdown",
        ...adminMainKeyboard(),
      });
    }

    // ---------------- RESTAURANTS ----------------
    if (action === "admin_restaurants") {
      const { data: restaurants, error } = await supabase
        .from("restaurants")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) return ctx.editMessageText("❌ Could not load restaurants.");

      const rows = (restaurants || []).map((r: any) => [
        Markup.button.callback(`${r.name}`, `admin_restaurant_view_${r.id}`),
        Markup.button.callback("✏️", `admin_restaurant_edit_${r.id}`),
        Markup.button.callback("🗑", `admin_restaurant_delete_${r.id}`),
      ]);
      rows.push([
        Markup.button.callback("➕ Add Restaurant", "admin_restaurant_add"),
      ]);
      rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

      return ctx.editMessageText("🍽 Restaurants:", Markup.inlineKeyboard(rows));
    }

    if (action === "admin_restaurant_add") {
      adminStates.set(adminId, { action: "add_restaurant" });
      return ctx.editMessageText(
        "🏗 Send restaurant name to add (single message)."
      );
    }

    if (/admin_restaurant_edit_(.+)/.test(action)) {
      const restaurantId = ctx.match[1];
      adminStates.set(adminId, { action: "edit_restaurant", restaurantId });
      return ctx.editMessageText("✏️ Send new name for the restaurant.");
    }

    if (/admin_restaurant_delete_(.+)/.test(action)) {
      const id = ctx.match[1];
      try {
        await supabase.from("restaurants").delete().eq("id", id);
        return ctx.editMessageText(`🗑 Restaurant deleted: ${id}`);
      } catch {
        return ctx.editMessageText("❌ Failed to delete restaurant.");
      }
    }

    if (/admin_restaurant_view_(.+)/.test(action)) {
      const id = ctx.match[1];
      const { data: r } = await supabase
        .from("restaurants")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!r) return ctx.answerCbQuery("⚠️ Not found", { show_alert: true });
      return ctx.editMessageText(
        `🍽 Restaurant: ${r.name}\nID: ${r.id}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Manage Foods", `admin_foods_for_${r.id}`)],
          [Markup.button.callback("🔙 Back", "admin_restaurants")],
        ])
      );
    }

    // ---------------- FOODS ----------------
    if (action === "admin_foods") {
      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("id,name");
      if (!restaurants || restaurants.length === 0)
        return ctx.editMessageText("No restaurants available.");

      const rows = restaurants.map((r: any) => [
        Markup.button.callback(`${r.name}`, `admin_foods_for_${r.id}`),
      ]);
      rows.push([Markup.button.callback("🔙 Back", "admin_back")]);
      return ctx.editMessageText(
        "Select restaurant to manage foods:",
        Markup.inlineKeyboard(rows)
      );
    }

    if (/admin_foods_for_(.+)/.test(action)) {
      const rid = ctx.match[1];
      const { data: foods } = await supabase
        .from("foods")
        .select("*")
        .eq("restaurant_id", rid);
      const rows = (foods || []).map((f: any) => [
        Markup.button.callback(
          `${f.name} (${f.price} ETB)`,
          `admin_food_view_${f.id}`
        ),
        Markup.button.callback("✏️", `admin_food_edit_${f.id}`),
        Markup.button.callback("🗑", `admin_food_delete_${f.id}`),
      ]);
      rows.push([
        Markup.button.callback("➕ Add Food", `admin_food_add_${rid}`),
      ]);
      rows.push([Markup.button.callback("🔙 Back", "admin_foods")]);
      return ctx.editMessageText(
        `🍔 Foods for restaurant ${rid}:`,
        Markup.inlineKeyboard(rows)
      );
    }

    if (/admin_food_add_(.+)/.test(action)) {
      const restaurantId = ctx.match[1];
      adminStates.set(adminId, { action: "add_food", restaurantId });
      return ctx.editMessageText(
        "🏗 Send food as: Name | Price (e.g. Burger | 50)"
      );
    }

    if (/admin_food_edit_(.+)/.test(action)) {
      const foodId = ctx.match[1];
      adminStates.set(adminId, { action: "edit_food", foodId });
      return ctx.editMessageText("✏️ Send new food as: Name | Price");
    }

    if (/admin_food_delete_(.+)/.test(action)) {
      const id = ctx.match[1];
      await supabase.from("foods").delete().eq("id", id);
      return ctx.editMessageText(`🗑 Food deleted: ${id}`);
    }

    if (/admin_food_view_(.+)/.test(action)) {
      const id = ctx.match[1];
      const { data: f } = await supabase
        .from("foods")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!f)
        return ctx.answerCbQuery("⚠️ Food not found", { show_alert: true });
      return ctx.editMessageText(
        `🍔 Food: ${f.name}\nPrice: ${f.price} ETB\nID: ${f.id}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "admin_foods")],
        ])
      );
    }

    // ---------------- RIDERS ----------------
    if (action === "admin_riders") {
      const { data: riders } = await supabase.from("riders").select("*");
      const rows = (riders || []).map((r: any) => [
        Markup.button.callback(
          `${r.name} (${r.campus})`,
          `admin_rider_view_${r.id}`
        ),
        Markup.button.callback(
          r.active ? "🟢" : "🔴",
          `admin_rider_toggle_${r.id}`
        ),
        Markup.button.callback("🗑", `admin_rider_delete_${r.id}`),
      ]);
      rows.push([Markup.button.callback("➕ Add Rider", "admin_rider_add")]);
      rows.push([Markup.button.callback("🔙 Back", "admin_back")]);
      return ctx.editMessageText("👤 Riders:", Markup.inlineKeyboard(rows));
    }

    if (action === "admin_rider_add") {
      adminStates.set(adminId, { action: "add_rider" });
      return ctx.editMessageText("🏗 Send rider info: Name | Phone | Campus");
    }

    if (/admin_rider_toggle_(.+)/.test(action)) {
      const id = ctx.match[1];
      const { data: rider } = await supabase
        .from("riders")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!rider) return ctx.reply("⚠️ Rider not found");
      await supabase
        .from("riders")
        .update({ active: !rider.active })
        .eq("id", id);
      return ctx.reply(
        `Rider ${rider.name} is now ${
          !rider.active ? "active 🟢" : "inactive 🔴"
        }`
      );
    }

    if (/admin_rider_delete_(.+)/.test(action)) {
      const id = ctx.match[1];
      await supabase.from("riders").delete().eq("id", id);
      return ctx.reply(`🗑 Rider deleted: ${id}`);
    }

    // ---------------- ORDERS ----------------
    if (action === "admin_orders") {
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (!orders || orders.length === 0)
        return ctx.editMessageText("No orders available.");
      const rows = orders.map((o: any) => [
        Markup.button.callback(
          `${o.user_name} | ${o.campus} | ${o.status}`,
          `admin_order_view_${o.id}`
        ),
        Markup.button.callback("🗑 Delete", `admin_order_delete_${o.id}`),
      ]);
      rows.push([Markup.button.callback("🔙 Back", "admin_back")]);
      return ctx.editMessageText("📋 Orders:", Markup.inlineKeyboard(rows));
    }

    if (/admin_order_delete_(.+)/.test(action)) {
      const id = ctx.match[1];
      await supabase.from("orders").delete().eq("id", id);
      return ctx.reply(`🗑 Order deleted: ${id}`);
    }

    // ---------------- DASHBOARD ----------------
    if (action === "admin_dashboard") {
      const [restaurantsCount, foodsCount, ridersCount, ordersCount] =
        await Promise.all([
          supabase
            .from("restaurants")
            .select("id")
            .then((r) => r.data?.length ?? 0),
          supabase
            .from("foods")
            .select("id")
            .then((r) => r.data?.length ?? 0),
          supabase
            .from("riders")
            .select("id")
            .then((r) => r.data?.length ?? 0),
          supabase
            .from("orders")
            .select("id")
            .then((r) => r.data?.length ?? 0),
        ]);
      return ctx.editMessageText(
        `📊 Dashboard\n\n🍽 Restaurants: ${restaurantsCount}\n🍔 Foods: ${foodsCount}\n🛵 Riders: ${ridersCount}\n🧾 Orders: ${ordersCount}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "admin_back")],
        ])
      );
    }
  });

  // ---------------- GLOBAL TEXT LISTENER ----------------
  bot.on("text", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    const state = adminStates.get(adminId);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
      switch (state.action) {
        case "add_restaurant":
          await supabase.from("restaurants").insert([{ name: text }]);
          await ctx.reply(`✅ Restaurant "${text}" added!`);
          break;
        case "edit_restaurant":
          if (state.restaurantId)
            await supabase
              .from("restaurants")
              .update({ name: text })
              .eq("id", state.restaurantId);
          await ctx.reply("✏️ Restaurant updated.");
          break;
        case "add_food":
          if (state.restaurantId) {
            const [name, priceStr] = text.split("|").map((p) => p.trim());
            const price = Number(priceStr);
            if (!name || isNaN(price)) return ctx.reply("⚠️ Use: Name | Price");
            await supabase
              .from("foods")
              .insert([{ name, price, restaurant_id: state.restaurantId }]);
            await ctx.reply(`✅ Food "${name}" added at ${price} ETB`);
          }
          break;
        case "edit_food":
          if (state.foodId) {
            const [name, priceStr] = text.split("|").map((p) => p.trim());
            const price = Number(priceStr);
            if (!name || isNaN(price)) return ctx.reply("⚠️ Use: Name | Price");
            await supabase
              .from("foods")
              .update({ name, price })
              .eq("id", state.foodId);
            await ctx.reply("✏️ Food updated.");
          }
          break;
        case "add_rider":
          const [name, phone, campus] = text.split("|").map((s) => s.trim());
          if (!name || !phone || !campus)
            return ctx.reply("⚠️ Use: Name | Phone | Campus");
          const secretCode = generateSecretCode();
          await supabase
            .from("riders")
            .insert([
              { name, phone, campus, secret_code: secretCode, active: true },
            ]);
          await ctx.reply(`✅ Rider "${name}" added with code: ${secretCode}`);
          break;
      }
    } catch (err) {
      console.error("[ADMIN] text error:", err);
      await ctx.reply("❌ An error occurred.");
    } finally {
      adminStates.delete(adminId);
    }
  });

  console.log("[ADMIN] setupAdminHandler initialized");
}
