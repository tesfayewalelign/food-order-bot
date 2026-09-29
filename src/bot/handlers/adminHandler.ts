import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";
import { requireAdmin, getUserRole } from "../../helpers/roles.js";
import {
  adminReplyKeyboard,
  customerMenuKeyboard,
  riderMenuKeyboard,
} from "../../helpers/keyboards.js";
import {
  DEFAULT_MEAL_ALLOWANCE,
  DEFAULT_DELIVERY_ALLOWANCE,
  hasActiveRestaurantContract,
  hasActiveDeliveryContract,
} from "../../helpers/contracts.js";
import { COMPANY_CONTACT } from "../../config/company.js";

type AdminStateAction =
  | "add_restaurant"
  | "edit_restaurant_name"
  | "add_food"
  | "edit_food_price"
  | "add_rider"
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

function adminMainInlineKeyboard() {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback("📊 Dashboard", "admin_dashboard"),
      Markup.button.callback("🍽 Restaurants", "admin_restaurants"),
      Markup.button.callback("🍔 Foods", "admin_foods"),
      Markup.button.callback("🛵 Riders", "admin_riders"),
      Markup.button.callback("📋 Orders", "admin_orders"),
      Markup.button.callback("📥 Contract Requests", "admin_contract_requests"),
      Markup.button.callback("💬 Complaints", "admin_complaints"),
      Markup.button.callback("⚙️ Settings", "admin_settings"),
    ],
    { columns: 2 }
  );
}

function formatPhoneLink(phone?: string): string {
  if (!phone) return "N/A";
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("09")) {
    cleaned = "+2519" + cleaned.slice(2);
  } else if (cleaned.startsWith("07")) {
    cleaned = "+2517" + cleaned.slice(2);
  } else if (cleaned.startsWith("251")) {
    cleaned = "+" + cleaned;
  }
  return cleaned ? `[${phone}](tel:${cleaned})` : phone;
}

export function setupAdminHandler(bot: Telegraf<Context>, ADMIN_IDS: number[]) {
  // Admin Command / /admin
  bot.command("admin", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.reply("*🛡️ Welcome to Admin Control Center*", {
      parse_mode: "Markdown",
      ...adminMainInlineKeyboard(),
    });
  });

  // Hears handlers for reply keyboard items
  bot.hears("📊 Dashboard", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showAdminDashboard(ctx);
  });

  bot.hears("🍽 Restaurants", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showRestaurantsMenu(ctx);
  });

  bot.hears("🍔 Foods", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showFoodsRestaurantSelector(ctx);
  });

  bot.hears("🛵 Riders", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showRidersMenu(ctx);
  });

  bot.hears("📋 Orders", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showOrdersMenu(ctx, "all");
  });

  bot.hears("📥 Contract Requests", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showContractRequestsMenu(ctx);
  });

  bot.hears("💬 Complaints", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showComplaintsMenu(ctx);
  });

  bot.hears("⚙️ Settings", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showSettingsMenu(ctx);
  });

  bot.action("admin_back", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    if (ctx.callbackQuery) {
      await ctx.editMessageText("*🛡️ Welcome to Admin Control Center*", {
        parse_mode: "Markdown",
        reply_markup: adminMainInlineKeyboard().reply_markup,
      });
    } else {
      await ctx.reply("*🛡️ Welcome to Admin Control Center*", {
        parse_mode: "Markdown",
        reply_markup: adminMainInlineKeyboard().reply_markup,
      });
    }
  });

  // Admin Text Input Handler
  bot.on("text", async (ctx, next) => {
    const adminId = ctx.from?.id;
    if (!adminId) return next();
    const role = await getUserRole(adminId);
    if (role !== "admin") return next();

    const state = adminStates.get(adminId);
    if (!state || state.action === "none") return next();

    const text = ctx.message.text.trim();

    try {
      switch (state.action) {
        case "add_restaurant": {
          await db.execute({
            sql: "INSERT INTO restaurants (name, active) VALUES (?, 1)",
            args: [text],
          });
          await ctx.reply(`✅ Restaurant "${text}" added!`);
          adminStates.delete(adminId);
          await showRestaurantsMenu(ctx);
          break;
        }

        case "edit_restaurant_name": {
          if (!state.restaurantId) break;
          await db.execute({
            sql: "UPDATE restaurants SET name = ? WHERE id = ?",
            args: [text, Number(state.restaurantId)],
          });
          await ctx.reply("✏️ Restaurant name updated.");
          adminStates.delete(adminId);
          await showRestaurantsMenu(ctx);
          break;
        }

        case "add_food": {
          if (!state.restaurantId) break;
          const [name, priceStr] = text.split("|").map((p) => p.trim());
          const price = Number(priceStr);
          if (!name || isNaN(price) || price < 0) {
            return ctx.reply("⚠️ Use format: Name | Price (e.g. Special Shiro | 150)");
          }

          await db.execute({
            sql: "INSERT INTO foods (restaurant_id, name, price, active) VALUES (?, ?, ?, 1)",
            args: [Number(state.restaurantId), name, price],
          });

          await ctx.reply(
            `✅ Food "${name}" added at ${price} ETB!`,
            Markup.inlineKeyboard([
              [Markup.button.callback("🔙 Back to Foods", `admin_foods_for_${state.restaurantId}`)],
            ])
          );
          adminStates.delete(adminId);
          break;
        }

        case "edit_food_price": {
          if (!state.foodId) break;
          const price = Number(text);
          if (isNaN(price) || price < 0) {
            return ctx.reply("⚠️ Please enter a valid price number (e.g. 150).");
          }

          await db.execute({
            sql: "UPDATE foods SET price = ? WHERE id = ?",
            args: [price, Number(state.foodId)],
          });

          await ctx.reply(`✏️ Food price updated to ${price} ETB!`);
          adminStates.delete(adminId);
          await showFoodsRestaurantSelector(ctx);
          break;
        }

        case "add_rider": {
          const [name, phone, campus] = text.split("|").map((s) => s.trim());
          if (!name || !phone || !campus) {
            return ctx.reply("⚠️ Format: Name | Phone | Campus (e.g. Abebe | 0912345678 | Main Boys Africa)");
          }

          const secretCode = generateSecretCode();
          await db.execute({
            sql: "INSERT INTO riders (name, phone, campus, secret_code, active) VALUES (?, ?, ?, ?, 1)",
            args: [name, phone, campus, secretCode],
          });

          await ctx.reply(
            `✅ Rider *${name}* added!\n\n🔑 Activation Code: \`${secretCode}\`\n\nTell the rider to run in Telegram:\n\`/activate ${secretCode}\``,
            { parse_mode: "Markdown" }
          );
          adminStates.delete(adminId);
          await showRidersMenu(ctx);
          break;
        }

        default:
          return next();
      }
    } catch (err) {
      console.error("Admin text handler error:", err);
      ctx.reply("❌ Error processing request.");
    }
  });

  // --- DASHBOARD ---
  bot.action("admin_dashboard", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showAdminDashboard(ctx);
  });

  async function showAdminDashboard(ctx: Context) {
    const todayStr = new Date().toISOString().split("T")[0];

    const [rRes, fRes, rdRes, oTodayRes, oPendingRes, oAcceptedRes, oDeliveredTodayRes, reqRes, cRes] =
      await Promise.all([
        db.execute("SELECT COUNT(*) as count FROM restaurants WHERE (active IS NULL OR active = 1)"),
        db.execute("SELECT COUNT(*) as count FROM foods WHERE (active IS NULL OR active = 1)"),
        db.execute("SELECT COUNT(*) as count FROM riders WHERE active = 1"),
        db.execute({
          sql: "SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')",
          args: [],
        }),
        db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'"),
        db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'accepted'"),
        db.execute({
          sql: "SELECT COUNT(*) as count FROM orders WHERE status = 'delivered' AND date(created_at) = date('now')",
          args: [],
        }),
        db.execute("SELECT COUNT(*) as count FROM contract_requests WHERE status = 'pending'"),
        db.execute("SELECT COUNT(*) as count FROM complaints WHERE (status IS NULL OR status = 'pending')"),
      ]);

    const dashboardText =
      `📊 *Admin Dashboard*\n\n` +
      `🍽️ *Active Restaurants:* ${rRes.rows[0]?.count ?? 0}\n` +
      `🍔 *Active Food Items:* ${fRes.rows[0]?.count ?? 0}\n` +
      `🛵 *Active Riders:* ${rdRes.rows[0]?.count ?? 0}\n\n` +
      `📦 *Today's Orders:* ${oTodayRes.rows[0]?.count ?? 0}\n` +
      `⏳ *Pending Orders:* ${oPendingRes.rows[0]?.count ?? 0}\n` +
      `🚴 *Accepted Orders:* ${oAcceptedRes.rows[0]?.count ?? 0}\n` +
      `✅ *Delivered Today:* ${oDeliveredTodayRes.rows[0]?.count ?? 0}\n\n` +
      `📥 *Pending Contract Requests:* ${reqRes.rows[0]?.count ?? 0}\n` +
      `💬 *New Complaints:* ${cRes.rows[0]?.count ?? 0}`;

    const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(dashboardText, {
        parse_mode: "Markdown",
        reply_markup: kb.reply_markup,
      });
    } else {
      await ctx.reply(dashboardText, {
        parse_mode: "Markdown",
        reply_markup: kb.reply_markup,
      });
    }
  }

  // --- RESTAURANTS MANAGEMENT ---
  bot.action("admin_restaurants", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showRestaurantsMenu(ctx);
  });

  async function showRestaurantsMenu(ctx: Context) {
    const res = await db.execute("SELECT id, name, active FROM restaurants ORDER BY id ASC");
    const restaurants = res.rows;

    const rows: any[] = restaurants.map((r: any) => {
      const statusIcon = r.active !== 0 ? "🟢 Active" : "🔴 Inactive";
      return [
        Markup.button.callback(
          `${r.name} (${statusIcon})`,
          `admin_rest_view_${r.id}`
        ),
      ];
    });

    rows.push([Markup.button.callback("➕ Add Restaurant", "admin_add_restaurant")]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    const text = "🍽 *Restaurants Management:*";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    }
  }

  bot.action("admin_add_restaurant", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    adminStates.set(ctx.from!.id, { action: "add_restaurant" });
    await ctx.reply("✏️ Type the name of the new restaurant:");
  });

  bot.action(/^admin_rest_view_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const restId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT id, name, active FROM restaurants WHERE id = ?",
      args: [restId],
    });
    const r = res.rows[0];
    if (!r) return ctx.reply("⚠️ Restaurant not found.");

    const activeStatus = r.active !== 0;

    const detailText =
      `🍽️ *Restaurant Details*\n\n` +
      `🆔 *ID:* ${r.id}\n` +
      `🏢 *Name:* ${r.name}\n` +
      `🟢 *Status:* ${activeStatus ? "Active" : "Inactive"}`;

    const rows = [
      [
        Markup.button.callback(
          activeStatus ? "🔴 Deactivate" : "🟢 Activate",
          `admin_rest_toggle_${r.id}`
        ),
        Markup.button.callback("✏️ Edit Name", `admin_rest_edit_${r.id}`),
      ],
      [Markup.button.callback("🍔 View Foods", `admin_foods_for_${r.id}`)],
      [Markup.button.callback("🔙 Back to Restaurants", "admin_restaurants")],
    ];

    await ctx.editMessageText(detailText, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_rest_toggle_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const restId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT active FROM restaurants WHERE id = ?",
      args: [restId],
    });
    const r = res.rows[0];
    if (!r) return;

    const newActive = r.active !== 0 ? 0 : 1;
    await db.execute({
      sql: "UPDATE restaurants SET active = ? WHERE id = ?",
      args: [newActive, restId],
    });

    await ctx.reply(`✅ Restaurant status updated to ${newActive ? "Active" : "Inactive"}.`);
    await showRestaurantsMenu(ctx);
  });

  bot.action(/^admin_rest_edit_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const restId = Number(ctx.match[1]);
    adminStates.set(ctx.from!.id, { action: "edit_restaurant_name", restaurantId: restId });
    await ctx.reply("✏️ Type the new name for the restaurant:");
  });

  // --- FOODS MANAGEMENT ---
  bot.action("admin_foods", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showFoodsRestaurantSelector(ctx);
  });

  async function showFoodsRestaurantSelector(ctx: Context) {
    const res = await db.execute("SELECT id, name FROM restaurants ORDER BY name ASC");
    const restaurants = res.rows;

    const rows = restaurants.map((r: any) => [
      Markup.button.callback(`🏢 ${r.name}`, `admin_foods_for_${r.id}`),
    ]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    const text = "🍔 *Select a restaurant to manage food items:*";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    }
  }

  bot.action(/^admin_foods_for_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const restId = Number(ctx.match[1]);

    const [restRes, foodsRes] = await Promise.all([
      db.execute({ sql: "SELECT name FROM restaurants WHERE id = ?", args: [restId] }),
      db.execute({
        sql: "SELECT id, name, price, active FROM foods WHERE restaurant_id = ? ORDER BY name ASC",
        args: [restId],
      }),
    ]);

    const restName = restRes.rows[0]?.name || "Restaurant";
    const foods = foodsRes.rows;

    const rows = foods.map((f: any) => {
      const statusIcon = f.active !== 0 ? "🟢" : "🔴";
      return [
        Markup.button.callback(
          `${statusIcon} ${f.name} — ${f.price} ETB`,
          `admin_food_view_${f.id}`
        ),
      ];
    });

    rows.push([Markup.button.callback("➕ Add New Food Item", `admin_add_food_to_${restId}`)]);
    rows.push([Markup.button.callback("🔙 Back to Restaurants", "admin_foods")]);

    await ctx.editMessageText(`🍔 *Manage Food Items for ${restName}:*`, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_add_food_to_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const restId = Number(ctx.match[1]);
    adminStates.set(ctx.from!.id, { action: "add_food", restaurantId: restId });
    await ctx.reply(
      "✏️ Type food details in format: `Name | Price`\nExample: `Special Shiro | 150`",
      { parse_mode: "Markdown" }
    );
  });

  bot.action(/^admin_food_view_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const foodId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT f.id, f.name, f.price, f.active, f.restaurant_id, r.name as restaurant_name FROM foods f LEFT JOIN restaurants r ON f.restaurant_id = r.id WHERE f.id = ?",
      args: [foodId],
    });
    const f = res.rows[0];
    if (!f) return ctx.reply("⚠️ Food item not found.");

    const activeStatus = f.active !== 0;

    const detailText =
      `🍔 *Food Item Details*\n\n` +
      `🆔 *ID:* ${f.id}\n` +
      `🏢 *Restaurant:* ${f.restaurant_name || "N/A"}\n` +
      `🍱 *Item:* ${f.name}\n` +
      `💰 *Price:* ${f.price} ETB\n` +
      `🟢 *Status:* ${activeStatus ? "Active" : "Inactive"}`;

    const rows = [
      [
        Markup.button.callback(
          activeStatus ? "🔴 Deactivate" : "🟢 Activate",
          `admin_food_toggle_${f.id}`
        ),
        Markup.button.callback("✏️ Edit Price", `admin_food_price_${f.id}`),
      ],
      [Markup.button.callback("🔙 Back to Foods List", `admin_foods_for_${f.restaurant_id}`)],
    ];

    await ctx.editMessageText(detailText, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_food_toggle_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const foodId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT active, restaurant_id FROM foods WHERE id = ?",
      args: [foodId],
    });
    const f = res.rows[0];
    if (!f) return;

    const newActive = f.active !== 0 ? 0 : 1;
    await db.execute({
      sql: "UPDATE foods SET active = ? WHERE id = ?",
      args: [newActive, foodId],
    });

    await ctx.reply(`✅ Food item status updated to ${newActive ? "Active" : "Inactive"}.`);
    await showFoodsRestaurantSelector(ctx);
  });

  bot.action(/^admin_food_price_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const foodId = Number(ctx.match[1]);
    adminStates.set(ctx.from!.id, { action: "edit_food_price", foodId });
    await ctx.reply("✏️ Type the new price for this food item (e.g. 160):");
  });

  // --- RIDERS MANAGEMENT ---
  bot.action("admin_riders", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showRidersMenu(ctx);
  });

  async function showRidersMenu(ctx: Context) {
    const res = await db.execute(
      "SELECT id, telegram_id, name, phone, campus, secret_code, active FROM riders ORDER BY name ASC"
    );
    const riders = res.rows;

    let text = "🛵 *Riders Directory:*\n\n";
    if (riders.length === 0) {
      text += "No riders registered yet.\n";
    } else {
      riders.forEach((r: any, i: number) => {
        const activeLabel = r.active !== 0 ? "🟢 Active" : "🔴 Inactive";
        const activatedLabel = r.telegram_id ? "Activated" : `Pending Code: \`${r.secret_code}\``;
        const telLink = formatPhoneLink(String(r.phone));

        text += `${i + 1}. *${r.name}* (📞 ${telLink})\n`;
        text += `   Campus: ${r.campus} | Status: *${activeLabel}*\n`;
        text += `   Account: ${activatedLabel}\n\n`;
      });
    }

    const rows: any[] = riders.map((r: any) => [
      Markup.button.callback(
        `${r.name} (${r.active !== 0 ? "🟢 Deactivate" : "🔴 Activate"})`,
        `admin_rider_toggle_${r.id}`
      ),
    ]);

    rows.push([Markup.button.callback("➕ Add Rider", "admin_add_rider")]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    }
  }

  bot.action("admin_add_rider", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    adminStates.set(ctx.from!.id, { action: "add_rider" });
    await ctx.reply(
      "✏️ Type rider details in format:\n`Name | Phone | Campus`\nExample: `Bekele | 0912345678 | Main Boys Africa`",
      { parse_mode: "Markdown" }
    );
  });

  bot.action(/^admin_rider_toggle_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const riderId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT active, name FROM riders WHERE id = ?",
      args: [riderId],
    });
    const r = res.rows[0];
    if (!r) return;

    const newActive = r.active !== 0 ? 0 : 1;
    await db.execute({
      sql: "UPDATE riders SET active = ? WHERE id = ?",
      args: [newActive, riderId],
    });

    await ctx.reply(`✅ Rider ${r.name} status updated to ${newActive ? "Active" : "Inactive"}.`);
    await showRidersMenu(ctx);
  });

  // --- ORDERS MANAGEMENT & STATUS FILTER ---
  bot.action("admin_orders", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showOrdersMenu(ctx, "all");
  });

  bot.action(/^admin_orders_filter_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const filter = (ctx.match && ctx.match[1]) ? String(ctx.match[1]) : "all";
    await showOrdersMenu(ctx, filter);
  });

  async function showOrdersMenu(ctx: Context, filter: string) {
    let sql = "SELECT id, user_name, phone, campus, restaurant, total_price, status, created_at FROM orders";
    let args: any[] = [];

    if (filter !== "all") {
      sql += " WHERE status = ?";
      args.push(filter);
    }

    sql += " ORDER BY id DESC LIMIT 15";

    const res = await db.execute({ sql, args });
    const orders = res.rows;

    let text = `📋 *Orders Directory (${filter.toUpperCase()}):*\n\n`;
    if (orders.length === 0) {
      text += "No orders found for this status.\n";
    } else {
      orders.forEach((o: any, i: number) => {
        text += `${i + 1}. *Order #${o.id}* — ${o.user_name}\n`;
        text += `   🏢 ${o.restaurant} | 💰 ${o.total_price} ETB\n`;
        text += `   Status: *${o.status}* | Date: ${o.created_at ? new Date(o.created_at).toLocaleTimeString() : "Recent"}\n\n`;
      });
    }

    const filterKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("All", "admin_orders_filter_all"),
        Markup.button.callback("⏳ Pending", "admin_orders_filter_pending"),
        Markup.button.callback("🚴 Accepted", "admin_orders_filter_accepted"),
      ],
      [
        Markup.button.callback("🚶 On the Way", "admin_orders_filter_on_the_way"),
        Markup.button.callback("📦 Picked Up", "admin_orders_filter_picked_up"),
        Markup.button.callback("✅ Delivered", "admin_orders_filter_delivered"),
      ],
      [Markup.button.callback("🔙 Back", "admin_back")],
    ]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: filterKeyboard.reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: filterKeyboard.reply_markup,
      });
    }
  }

  // --- CONTRACT REQUESTS MANAGEMENT ---
  bot.action("admin_contract_requests", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showContractRequestsMenu(ctx);
  });

  async function showContractRequestsMenu(ctx: Context) {
    const res = await db.execute({
      sql: "SELECT id, user_name, phone, campus, request_type, restaurant_name, status, created_at FROM contract_requests ORDER BY id DESC LIMIT 20",
      args: [],
    });
    const requests = res.rows;

    if (requests.length === 0) {
      const text = "📥 *Contract Requests*\n\n📂 No contract requests found.";
      const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]);
      if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb.reply_markup });
      }
      return ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb.reply_markup });
    }

    const rows = requests.map((r: any) => {
      const typeLabel = r.request_type === "food_contract" ? "🍱 Food Contract" : "🚚 Delivery Contract";
      return [
        Markup.button.callback(
          `[${typeLabel}] ${r.user_name} (${r.status || "pending"})`,
          `admin_req_view_${r.id}`
        ),
      ];
    });

    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    const text = "📥 *Contract Requests:*";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    }
  }

  bot.action(/^admin_req_view_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const reqId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (!r) return ctx.reply("⚠️ Request not found.");

    const typeLabel = r.request_type === "food_contract" ? "🍱 Food Contract" : "🚚 Delivery Contract";
    const telLink = formatPhoneLink(String(r.phone));

    const detailText =
      `📥 *Contract Request Details*\n\n` +
      `🆔 *Request ID:* #${r.id}\n` +
      `📋 *Type:* ${typeLabel}\n` +
      `👤 *Customer Name:* ${r.user_name}\n` +
      `📞 *Phone:* ${telLink}\n` +
      `🏫 *Campus:* ${r.campus || "N/A"}\n` +
      `${r.request_type === "food_contract" ? `🏢 *Restaurant:* ${r.restaurant_name}\n` : ""}` +
      `📦 *Status:* ${r.status}\n` +
      `🕒 *Submitted:* ${r.created_at ? new Date(String(r.created_at)).toLocaleString() : "Recent"}`;

    const rows = [];
    if (r.status === "pending") {
      rows.push([
        Markup.button.callback("✅ Approve Contract", `admin_req_approve_${r.id}`),
        Markup.button.callback("❌ Reject", `admin_req_reject_${r.id}`),
      ]);
    }
    rows.push([Markup.button.callback("🔙 Back to Requests", "admin_contract_requests")]);

    await ctx.editMessageText(detailText, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  // Contract Approval (Requirement 18, 19, 20)
  bot.action(/^admin_req_approve_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const reqId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (!r) return ctx.reply("⚠️ Request not found.");
    const telegramId = Number(r.telegram_id);

    if (r.request_type === "food_contract") {
      // Check duplicate active contract first (Requirement 18)
      const hasActive = await hasActiveRestaurantContract(telegramId, r.restaurant_id ? Number(r.restaurant_id) : null);
      if (hasActive) {
        await db.execute({
          sql: "UPDATE contract_requests SET status = 'already_active' WHERE id = ?",
          args: [reqId],
        });
        return ctx.reply("ℹ️ Customer already has an active food contract for this restaurant.");
      }

      await db.execute({
        sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
              VALUES (?, ?, ?, ?, 1)`,
        args: [
          telegramId,
          r.restaurant_id ? Number(r.restaurant_id) : null,
          String(r.restaurant_name || "Custom Restaurant"),
          DEFAULT_MEAL_ALLOWANCE,
        ],
      });

      try {
        await bot.telegram.sendMessage(
          telegramId,
          `✅ *Food Contract Approved!*\n\nYour food contract request for *${r.restaurant_name}* (${DEFAULT_MEAL_ALLOWANCE} meals) has been approved by admin!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    } else {
      // Check duplicate active contract first (Requirement 18)
      const hasActive = await hasActiveDeliveryContract(telegramId);
      if (hasActive) {
        await db.execute({
          sql: "UPDATE contract_requests SET status = 'already_active' WHERE id = ?",
          args: [reqId],
        });
        return ctx.reply("ℹ️ Customer already has an active delivery contract.");
      }

      await db.execute({
        sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
              VALUES (?, ?, ?, 1)`,
        args: [telegramId, String(r.campus || ""), DEFAULT_DELIVERY_ALLOWANCE],
      });

      try {
        await bot.telegram.sendMessage(
          telegramId,
          `✅ *Delivery Contract Approved!*\n\nYour delivery contract request (${DEFAULT_DELIVERY_ALLOWANCE} deliveries) has been approved by admin!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    await db.execute({
      sql: "UPDATE contract_requests SET status = 'approved' WHERE id = ?",
      args: [reqId],
    });

    await ctx.editMessageText(`✅ Request #${reqId} approved and contract activated!`);
  });

  bot.action(/^admin_req_reject_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const reqId = Number(ctx.match[1]);

    await db.execute({
      sql: "UPDATE contract_requests SET status = 'rejected' WHERE id = ?",
      args: [reqId],
    });
    await ctx.editMessageText(`❌ Request #${reqId} marked as rejected.`);
  });

  // --- COMPLAINTS MANAGEMENT ---
  bot.action("admin_complaints", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showComplaintsMenu(ctx);
  });

  async function showComplaintsMenu(ctx: Context) {
    const res = await db.execute("SELECT * FROM complaints ORDER BY id DESC LIMIT 20");
    const complaints = res.rows;

    if (complaints.length === 0) {
      const text = "💬 *User Complaints*\n\n📂 No complaints submitted yet.";
      const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]);
      if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb.reply_markup });
      }
      return ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb.reply_markup });
    }

    let listText = `💬 *User Complaints (Latest ${complaints.length})*\n\n`;
    const rows: any[] = [];

    complaints.forEach((c: any, index: number) => {
      const telLink = formatPhoneLink(String(c.user_phone));
      const statusLabel = c.status === "resolved" ? "✅ Resolved" : c.status === "reviewing" ? "🔍 Reviewing" : "⏳ Pending";

      listText += `*${index + 1}. 👤 ${c.user_name}* (📞 ${telLink})\n`;
      listText += `💬 ${c.message}\n`;
      listText += `Status: *${statusLabel}* | 🕒 ${c.created_at ? new Date(c.created_at).toLocaleString() : "Recently"}\n\n`;

      if (c.status !== "resolved") {
        rows.push([
          Markup.button.callback(
            `Mark #${c.id} Resolved`,
            `admin_complaint_resolve_${c.id}`
          ),
        ]);
      }
    });

    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(listText, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } else {
      await ctx.reply(listText, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    }
  }

  bot.action(/^admin_complaint_resolve_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const cid = Number(ctx.match[1]);

    await db.execute({
      sql: "UPDATE complaints SET status = 'resolved' WHERE id = ?",
      args: [cid],
    });

    await ctx.reply(`✅ Complaint #${cid} marked as Resolved.`);
    await showComplaintsMenu(ctx);
  });

  // --- SETTINGS ---
  bot.action("admin_settings", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showSettingsMenu(ctx);
  });

  async function showSettingsMenu(ctx: Context) {
    const text =
      `⚙️ *System Settings & Contract Allowances*\n\n` +
      `🏢 *Company:* ${COMPANY_CONTACT.name}\n` +
      `📱 *Support Phone:* ${COMPANY_CONTACT.phone}\n` +
      `💬 *Support Telegram:* ${COMPANY_CONTACT.telegram}\n\n` +
      `🍱 *Default Meal Allowance:* ${DEFAULT_MEAL_ALLOWANCE} meals\n` +
      `🚚 *Default Delivery Allowance:* ${DEFAULT_DELIVERY_ALLOWANCE} deliveries`;

    const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: kb.reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: kb.reply_markup,
      });
    }
  }
}
