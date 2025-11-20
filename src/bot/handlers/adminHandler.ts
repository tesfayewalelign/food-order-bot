import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";

type AdminStateAction =
  | "add_restaurant"
  | "edit_restaurant"
  | "add_food"
  | "edit_food"
  | "add_rider"
  | "edit_rider"
  | "none";

interface AdminState {
  action?: AdminStateAction;
  restaurantId?: string | number | null;
  foodId?: string | number | null;
  riderId?: string | number | null;
}

const adminStates = new Map<number, AdminState>();

function generateSecretCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isTextMessage(
  ctx: Context
): ctx is Context & { message: { text: string } } {
  return !!ctx.message && typeof (ctx.message as any).text === "string";
}
async function handleAdminText(ctx: Context, state: AdminState) {
  const msg = ctx.message;
  if (!msg || !("text" in msg)) return;

  switch (msg.text) {
    case "📥 View Orders":
      // your logic here
      break;
    case "➕ Add Restaurant":
      // your logic here
      break;
    default:
      await ctx.reply("⚠️ Unknown admin command.");
  }
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
  bot.command("admin", async (ctx) => {
    const id = ctx.from?.id;
    if (!id || !ADMIN_IDS.includes(id)) return ctx.reply("🚫 Not authorized.");
    console.log("[ADMIN] /admin opened by", id);
    await ctx.reply("*👋 Welcome to Admin Panel*", {
      parse_mode: "Markdown",
      ...adminMainKeyboard(),
    });
  });
  bot.on("text", async (ctx, next) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return next();
    const state = adminStates.get(adminId);
    if (!state) return next();
    await handleAdminText(ctx, state);
    adminStates.delete(adminId);
  });

  bot.action("admin_back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText("*👋 Admin Panel*", {
      parse_mode: "Markdown",
      ...adminMainKeyboard(),
    });
  });

  bot.action("admin_restaurants", async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId))
      return ctx.reply("🚫 Not authorized.");

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

    await ctx.editMessageText("🍽 Restaurants:", Markup.inlineKeyboard(rows));
  });

  bot.action("admin_restaurant_add", async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId) return;
    adminStates.set(adminId, { action: "add_restaurant" });
    await ctx.editMessageText(
      "🏗 Send restaurant name to add (single message)."
    );
  });

  bot.action(/admin_restaurant_edit_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    const restaurantId = ctx.match[1];
    if (!adminId) return;
    adminStates.set(adminId, { action: "edit_restaurant", restaurantId });
    await ctx.editMessageText("✏️ Send new name for the restaurant.");
  });

  bot.action(/admin_restaurant_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    try {
      await supabase.from("restaurants").delete().eq("id", id);
      await ctx.editMessageText(`🗑 Restaurant deleted: ${id}`);
    } catch {
      await ctx.editMessageText("❌ Failed to delete restaurant.");
    }
  });

  bot.action(/admin_restaurant_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: r, error } = await supabase
      .from("restaurants")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!r || error)
      return ctx.answerCbQuery("⚠️ Not found", { show_alert: true });

    await ctx.editMessageText(
      `🍽 Restaurant: ${r.name}\nID: ${r.id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Manage Foods", `admin_foods_for_${r.id}`)],
        [Markup.button.callback("🔙 Back", "admin_restaurants")],
      ])
    );
  });

  bot.action("admin_foods", async (ctx) => {
    await ctx.answerCbQuery();
    const { data: restaurants } = await supabase
      .from("restaurants")
      .select("id,name");
    if (!restaurants || restaurants.length === 0)
      return ctx.editMessageText("No restaurants available.");

    const rows = restaurants.map((r: any) => [
      Markup.button.callback(`${r.name}`, `admin_foods_for_${r.id}`),
    ]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText(
      "Select restaurant to manage foods:",
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/admin_foods_for_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
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
    rows.push([Markup.button.callback("➕ Add Food", `admin_food_add_${rid}`)]);
    rows.push([Markup.button.callback("🔙 Back", "admin_foods")]);

    await ctx.editMessageText(
      `🍔 Foods for restaurant ${rid}:`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/admin_food_add_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    const restaurantId = ctx.match[1];
    adminStates.set(adminId!, { action: "add_food", restaurantId });
    await ctx.editMessageText(
      "🏗 Send food as: Name | Price (e.g. Burger | 50)"
    );
  });

  bot.action(/admin_food_edit_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    const foodId = ctx.match[1];
    adminStates.set(adminId!, { action: "edit_food", foodId });
    await ctx.editMessageText("✏️ Send new food as: Name | Price");
  });

  bot.action(/admin_food_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    try {
      await supabase.from("foods").delete().eq("id", id);
      await ctx.editMessageText(`🗑 Food deleted: ${id}`);
    } catch {
      await ctx.editMessageText("❌ Failed to delete food.");
    }
  });

  bot.action(/admin_food_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: f } = await supabase
      .from("foods")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!f) return ctx.answerCbQuery("⚠️ Food not found", { show_alert: true });

    await ctx.editMessageText(
      `🍔 Food: ${f.name}\nPrice: ${f.price} ETB\nID: ${f.id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back", "admin_foods")],
      ])
    );
  });

  bot.action("admin_riders", async (ctx) => {
    await ctx.answerCbQuery();
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
    await ctx.editMessageText("👤 Riders:", Markup.inlineKeyboard(rows));
  });

  bot.action("admin_rider_add", async (ctx) => {
    await ctx.answerCbQuery();
    const adminId = ctx.from?.id;
    if (!adminId) return;

    adminStates.set(adminId, { action: "add_rider" });
    await ctx.editMessageText(
      "🏗 Send rider info in this format:\nName | Phone | Campus"
    );
  });

  bot.on("text", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;

    const state = adminStates.get(adminId);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
      if (state.action === "add_rider") {
        const [name, phone, campus] = text.split("|").map((t) => t.trim());
        if (!name || !phone || !campus)
          return ctx.reply("⚠️ Invalid format. Use: Name | Phone | Campus");

        const secret_code = Math.floor(1000 + Math.random() * 9000).toString();

        const { error } = await supabase
          .from("riders")
          .insert([{ name, phone, campus, secret_code }]);

        if (error) return ctx.reply("❌ Failed to add rider.");

        await ctx.reply(
          `✅ Rider "${name}" added!\nSecret code: ${secret_code}\nSend this code to the rider to activate the bot with:\n/activate ${secret_code}`
        );
      }
    } catch (err) {
      console.error("[ADMIN] text error:", err);
      await ctx.reply("❌ An error occurred.");
    } finally {
      adminStates.delete(adminId);
    }
  });

  bot.action(/admin_rider_toggle_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
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

    await ctx.reply(
      `Rider ${rider.name} is now ${
        !rider.active ? "active 🟢" : "inactive 🔴"
      }`
    );
  });

  bot.action(/admin_rider_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("riders").delete().eq("id", id);
    await ctx.reply(`🗑 Rider deleted: ${id}`);
  });

  bot.on("text", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;
    const state = adminStates.get(adminId);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
      if (state.action === "add_rider") {
        const [name, phone, campus] = text.split("|").map((s) => s.trim());
        if (!name || !phone || !campus)
          return ctx.reply("⚠️ Use format: Name | Phone | Campus");

        const secretCode = generateSecretCode();

        const { error } = await supabase
          .from("riders")
          .insert([
            { name, phone, campus, secret_code: secretCode, active: true },
          ]);

        if (error) return ctx.reply("❌ Failed to add rider.");

        await ctx.reply(
          `✅ Rider "${name}" added with secret code: ${secretCode}`
        );
      }
    } catch (err) {
      console.error("[ADMIN] text error:", err);
      await ctx.reply("❌ An error occurred.");
    } finally {
      adminStates.delete(adminId);
    }
  });

  bot.action("admin_orders", async (ctx) => {
    await ctx.answerCbQuery();
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

    await ctx.editMessageText("📋 Orders:", Markup.inlineKeyboard(rows));
  });

  bot.action(/admin_order_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: o } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!o)
      return ctx.answerCbQuery("⚠️ Order not found", { show_alert: true });

    await ctx.editMessageText(
      `🧾 Order ID: ${o.id}\nUser: ${o.user_name}\nPhone: ${o.phone}\nCampus: ${o.campus}\nRestaurant: ${o.restaurant}\nFoods: ${o.foods}\nTotal: ${o.total_price} ETB\nStatus: ${o.status}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            o.status === "Pending" ? "✅ Complete Order" : "↩️ Mark Pending",
            `admin_order_toggle_${o.id}`
          ),
        ],
        [Markup.button.callback("🔙 Back", "admin_orders")],
      ])
    );
  });

  bot.action(/admin_order_toggle_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: o } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!o) return ctx.reply("⚠️ Order not found");
    const newStatus = o.status === "Pending" ? "Completed" : "Pending";
    await supabase.from("orders").update({ status: newStatus }).eq("id", id);
    await ctx.reply(`✅ Order status updated to ${newStatus}`);
    ctx.deleteMessage();
  });

  bot.action(/admin_order_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("orders").delete().eq("id", id);
    await ctx.reply(`🗑 Order deleted: ${id}`);
  });

  bot.action("admin_contract_requests", async (ctx) => {
    await ctx.answerCbQuery();

    const { data: requests } = await supabase
      .from("contract_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!requests || requests.length === 0)
      return ctx.editMessageText("No contract requests available.");

    const rows = requests.map((r) => [
      Markup.button.callback(
        `${r.user_name} | ${r.status}`,
        `admin_contract_request_view_${r.id}`
      ),
    ]);

    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText(
      "📥 Contract Requests:",
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/admin_contract_request_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();

    const id = ctx.match[1];

    const { data: r } = await supabase
      .from("contract_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!r)
      return ctx.answerCbQuery("⚠️ Request not found", { show_alert: true });

    await ctx.reply(
      "Please approve or reject the contract request:", // message text
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Approve",
              `admin_contract_request_approve_${r.id}`
            ),
          ],
          [
            Markup.button.callback(
              "❌ Reject",
              `admin_contract_request_reject_${r.id}`
            ),
          ],
          [Markup.button.callback("🔙 Back", "admin_contract_requests")],
        ]).reply_markup, // <-- use .reply_markup here
      }
    );
  });

  bot.action(/admin_contract_request_approve_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();

    const id = ctx.match[1];

    const { data: req } = await supabase
      .from("contract_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!req) return ctx.reply("⚠️ Request not found");

    // Create contract
    await supabase.from("contracts").insert([
      {
        user_name: req.user_name,
        start_date: req.start_date,
        end_date: req.end_date,
        telegram_id: req.telegram_id,
        status: "Active",
      },
    ]);

    // Remove request
    await supabase.from("contract_requests").delete().eq("id", id);

    // Notify the user
    await ctx.telegram.sendMessage(
      req.telegram_id,
      "✅ *Your contract request has been approved!*",
      { parse_mode: "Markdown" }
    );

    await ctx.reply("✅ Contract approved and activated!");
    ctx.deleteMessage();
  });

  bot.action(/admin_contract_request_reject_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();

    const id = ctx.match[1];

    const { data: req } = await supabase
      .from("contract_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!req) return ctx.reply("⚠️ Request not found");

    // Update status
    await supabase
      .from("contract_requests")
      .update({ status: "Rejected" })
      .eq("id", id);

    await ctx.telegram.sendMessage(
      req.telegram_id,
      "❌ *Your contract request was rejected.*",
      { parse_mode: "Markdown" }
    );

    await ctx.reply("❌ Contract request rejected!");
    ctx.deleteMessage();
  });

  bot.action(/admin_contract_request_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("contract_requests").delete().eq("id", id);
    await ctx.reply(`🗑 Contract request deleted: ${id}`);
  });

  // ---------------- Active Contracts ----------------
  bot.action("admin_contracts", async (ctx) => {
    await ctx.answerCbQuery();

    const { data: contracts } = await supabase
      .from("contracts")
      .select("*")
      .order("created_at", { ascending: false });

    if (!contracts || contracts.length === 0)
      return ctx.editMessageText("No active contracts.");

    const rows = contracts.map((c: any) => [
      Markup.button.callback(
        `${c.user_name} | ${c.status}`,
        `admin_contract_view_${c.id}`
      ),
      Markup.button.callback("🗑 Delete", `admin_contract_delete_${c.id}`),
      Markup.button.callback(
        "🔄 Reactivate",
        `admin_contract_reactivate_${c.id}`
      ),
    ]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText(
      "📦 Active Contracts:",
      Markup.inlineKeyboard(rows)
    );
  });

  // ---------------- Reactivate Contract ----------------
  bot.action(/admin_contract_reactivate_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];

    const { data: c } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!c) return ctx.reply("⚠️ Contract not found");

    await supabase.from("contracts").update({ status: "Active" }).eq("id", id);
    await ctx.reply(`🔄 Contract for ${c.user_name} has been reactivated!`);
    ctx.deleteMessage();
  });

  bot.action(/admin_contract_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("contracts").delete().eq("id", id);
    await ctx.reply(`🗑 Contract deleted: ${id}`);
  });

  bot.action("admin_dashboard", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const [
        restaurantsCount,
        foodsCount,
        ridersCount,
        ordersCount,
        contractsCount,
      ] = await Promise.all([
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
        supabase
          .from("contracts")
          .select("id")
          .then((r) => r.data?.length ?? 0),
      ]);

      const text = `📊 Dashboard\n\n🍽 Restaurants: ${restaurantsCount}\n🍔 Foods: ${foodsCount}\n🛵 Riders: ${ridersCount}\n🧾 Orders: ${ordersCount}\n📦 Contracts: ${contractsCount}`;
      await ctx.editMessageText(
        text,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "admin_back")],
        ])
      );
    } catch {
      await ctx.editMessageText("❌ Failed to load dashboard.");
    }
  });

  // ---------------- Global Text Listener ----------------
  bot.on("text", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) return;
    const state = adminStates.get(adminId);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
      if (state.action === "add_restaurant") {
        const { error } = await supabase
          .from("restaurants")
          .insert([{ name: text }]);
        if (error) return ctx.reply("❌ Failed to add restaurant.");
        await ctx.reply(`✅ Restaurant "${text}" added!`);
      }

      if (state.action === "edit_restaurant" && state.restaurantId) {
        await supabase
          .from("restaurants")
          .update({ name: text })
          .eq("id", state.restaurantId);
        await ctx.reply(`✏️ Restaurant updated.`);
      }

      if (state.action === "add_food" && state.restaurantId) {
        const [name, priceStr] = text.split("|").map((p) => p.trim());
        const price = Number(priceStr);
        if (!name || isNaN(price)) return ctx.reply("⚠️ Use: Name | Price");
        await supabase
          .from("foods")
          .insert([{ name, price, restaurant_id: state.restaurantId }]);
        await ctx.reply(`✅ Food "${name}" added at ${price} ETB`);
      }

      if (state.action === "edit_food" && state.foodId) {
        const [name, priceStr] = text.split("|").map((p) => p.trim());
        const price = Number(priceStr);
        if (!name || isNaN(price)) return ctx.reply("⚠️ Use: Name | Price");
        await supabase
          .from("foods")
          .update({ name, price })
          .eq("id", state.foodId);
        await ctx.reply("✏️ Food updated.");
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
