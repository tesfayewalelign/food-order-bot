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

export const CAMPUS_KEYS = {
  MAIN_BOYS_WHITES_HOUSE: "campus_main_boys_whites_house",
  MAIN_BOYS_AFRICA: "campus_main_boys_africa",
  MAIN_GIRLS_WHITE_HOUSE: "campus_main_girls_white_house",
  MAIN_GIRLS_AFRICA_HOUSE: "campus_main_girls_africa_house",
  TECHNO_BOYS: "campus_techno_boys",
  TECHNO_GIRLS: "campus_techno_girls",
  AGRI_CAMPUS: "campus_agri",
} as const;

export type CampusKey = (typeof CAMPUS_KEYS)[keyof typeof CAMPUS_KEYS];

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

    const text = ctx.message.text.trim();

    try {
      switch (state.action) {
        case "add_restaurant": {
          const { error } = await supabase
            .from("restaurants")
            .insert([{ name: text }]);
          if (error) return ctx.reply("❌ Failed to add restaurant.");
          await ctx.reply(`✅ Restaurant "${text}" added!`);
          adminStates.delete(adminId);
          break;
        }

        case "edit_restaurant": {
          if (!state.restaurantId) break;
          await supabase
            .from("restaurants")
            .update({ name: text })
            .eq("id", state.restaurantId);
          await ctx.reply("✏️ Restaurant updated.");
          adminStates.delete(adminId);
          break;
        }

        case "add_food": {
          if (!state.restaurantId) break;
          const [name, priceStr] = text.split("|").map((p) => p.trim());
          const price = Number(priceStr);
          if (!name || isNaN(price)) return ctx.reply("⚠️ Use: Name | Price");

          await supabase
            .from("foods")
            .insert([{ name, price, restaurant_id: state.restaurantId }]);

          adminStates.set(adminId, state);

          await ctx.reply(
            `✅ Food "${name}" added at ${price} ETB\nSend next food or press 🔙 Done`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "🔙 Back",
                  `admin_foods_for_${state.restaurantId}`
                ),
              ],
              [Markup.button.callback("✅ Done", "admin_foods")],
            ])
          );
          break;
        }

        case "add_rider": {
          const [name, phone, campusRaw] = text.split("|").map((s) => s.trim());

          if (!name || !phone || !campusRaw) {
            return ctx.reply(
              "⚠️ Invalid format.\nUse:\nName | Phone | Campus\n\nExample:\nBekele | 0977262232 | techno boys"
            );
          }

          const cleanCampus = campusRaw
            .toLowerCase()
            .replace(/dorm/g, "")
            .replace(/campus/g, "")
            .replace(/[^a-z ]/g, "")
            .replace(/\s+/g, "_")
            .trim();

          const campusKey = Object.values(CAMPUS_KEYS).find((key) =>
            key.endsWith(cleanCampus)
          );

          if (!campusKey) {
            return ctx.reply(
              "⚠️ Invalid campus.\nAvailable campus keys:\n\n" +
                Object.values(CAMPUS_KEYS).join("\n")
            );
          }

          const secretCode = generateSecretCode();

          const { error } = await supabase.from("riders").insert([
            {
              name,
              phone,
              campus: campusKey,
              secret_code: secretCode,
              active: true,
              telegram_id: null,
            },
          ]);

          if (error) return ctx.reply("❌ Failed to add rider.");

          await ctx.reply(
            `✅ Rider "${name}" added successfully!\nCampus: ${campusKey}\nSecret code: ${secretCode}\nSend this to rider: /activate ${secretCode}`
          );

          adminStates.delete(adminId);
          break;
        }

        default:
          return next();
      }
    } catch (err) {
      console.error("[ADMIN] text error:", err);
      await ctx.reply("❌ An error occurred.");
    }

    await next();
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
    adminStates.set(ctx.from!.id, { action: "add_restaurant" });
    await ctx.editMessageText(
      "🏗 Send restaurant name to add (single message)."
    );
  });

  bot.action(/admin_restaurant_edit_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const restaurantId = ctx.match[1];
    adminStates.set(ctx.from!.id, { action: "edit_restaurant", restaurantId });
    await ctx.editMessageText("✏️ Send new name for the restaurant.");
  });

  bot.action(/admin_restaurant_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("restaurants").delete().eq("id", id);
    await ctx.editMessageText(`🗑 Restaurant deleted: ${id}`);
  });

  bot.action(/admin_restaurant_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: r } = await supabase
      .from("restaurants")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!r) return ctx.answerCbQuery("⚠️ Not found", { show_alert: true });
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
    const restaurantId = ctx.match[1];
    adminStates.set(ctx.from!.id, { action: "add_food", restaurantId });
    await ctx.editMessageText(
      "🏗 Send food as: Name | Price (e.g. Burger | 50)"
    );
  });

  bot.action(/admin_food_edit_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const foodId = ctx.match[1];
    adminStates.set(ctx.from!.id, { action: "edit_food", foodId });
    await ctx.editMessageText("✏️ Send new food as: Name | Price");
  });

  bot.action(/admin_food_delete_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await supabase.from("foods").delete().eq("id", id);
    await ctx.editMessageText(`🗑 Food deleted: ${id}`);
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
    adminStates.set(ctx.from!.id, { action: "add_rider" });

    const campusList = Object.values(CAMPUS_KEYS)
      .map((key) => `- ${key}`)
      .join("\n");

    await ctx.editMessageText(
      `🏗 Send rider info in this format:\nName | Phone | CampusKey\n\nAvailable campus keys:\n${campusList}`
    );
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
  bot.action("admin_contracts", async (ctx) => {
    await ctx.answerCbQuery();
    const { data: contracts, error } = await supabase
      .from("contracts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !contracts || contracts.length === 0)
      return ctx.editMessageText("📦 No contracts available.");

    const rows = contracts.map((c: any) => [
      Markup.button.callback(
        `Contract: ${c.title || c.id} | ${c.status}`,
        `admin_contract_view_${c.id}`
      ),
    ]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText("📦 Contracts:", Markup.inlineKeyboard(rows));
  });

  bot.action(/admin_contract_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const { data: c } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!c)
      return ctx.answerCbQuery("⚠️ Contract not found", { show_alert: true });

    await ctx.editMessageText(
      `📦 Contract ID: ${c.id}\nTitle: ${c.title || "-"}\nStatus: ${c.status}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back", "admin_contracts")],
      ])
    );
  });

  bot.action("admin_contract_requests", async (ctx) => {
    await ctx.answerCbQuery();

    const { data: requests, error } = await supabase
      .from("contract_requests")
      .select("id, username, full_name, phone, status")
      .order("created_at", { ascending: false });

    if (error || !requests || requests.length === 0) {
      return ctx.editMessageText("📥 No requests available.");
    }

    const rows = requests.map((r: any) => [
      Markup.button.callback(
        `${r.full_name ?? r.username ?? "Unknown"} | ${r.status ?? "Pending"}`,
        `admin_request_view_${r.id}`
      ),
    ]);

    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText(
      "📥 Contract Requests:",
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/admin_request_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();

    const id = ctx.match[1];
    const { data: r } = await supabase
      .from("contract_requests")
      .select("id, username, full_name, phone, status")
      .eq("id", id)
      .maybeSingle();

    if (!r) {
      return ctx.answerCbQuery("⚠️ Request not found", { show_alert: true });
    }

    await ctx.editMessageText(
      `📥 Request ID: ${r.id}\n` +
        `Username: ${r.username ?? "N/A"}\n` +
        `Full Name: ${r.full_name ?? "N/A"}\n` +
        `Phone: ${r.phone ?? "N/A"}\n` +
        `Status: ${r.status ?? "Pending"}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve", `admin_request_approve_${r.id}`)],
        [Markup.button.callback("❌ Reject", `admin_request_reject_${r.id}`)],
        [Markup.button.callback("🔙 Back", "admin_contract_requests")],
      ])
    );
  });

  bot.action(/admin_request_approve_(\d+)/, async (ctx) => {
    const requestId = Number(ctx.match[1]);

    try {
      const { data: request } = await supabase
        .from("contract_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      if (!request) return ctx.reply("❌ Request not found.");

      await supabase.from("users").upsert(
        {
          telegram_id: request.user_id,
          name: request.full_name,
          created_at: new Date().toISOString(),
        },
        { onConflict: "telegram_id" }
      );

      await supabase.from("contracts").upsert(
        {
          user_id: request.user_id,
          order_limit: 30,
          remaining_orders: 30,
          is_active: true,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      await supabase
        .from("contract_requests")
        .update({ status: "approved" })
        .eq("id", requestId);

      await ctx.telegram.sendMessage(
        request.user_id,
        "✅ Your contract request has been approved! You can now choose *Use Contract* at checkout.",
        { parse_mode: "Markdown" }
      );

      return ctx.editMessageText(
        `✅ Request #${requestId} approved and contract created.`
      );
    } catch (err) {
      console.error("Admin approve contract error:", err);
      return ctx.reply("❌ Failed to approve contract. See logs.");
    }
  });

  bot.action(/admin_request_reject_(\d+)/, async (ctx) => {
    const requestId = Number(ctx.match[1]);

    try {
      await supabase
        .from("contract_requests")
        .update({ status: "rejected" })
        .eq("id", requestId);

      return ctx.editMessageText(`❌ Request #${requestId} rejected`);
    } catch (err) {
      console.error("Admin reject contract error:", err);
      return ctx.reply("❌ Failed to reject contract. See logs.");
    }
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

  console.log("[ADMIN] setupAdminHandler initialized");
}
