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
import {
  getApplicableDeliveryPrice,
  setCampusDeliveryPrice,
  setRestaurantDeliveryPrice,
  getCampusDeliveryPrices,
  getRestaurantDeliveryPrices,
  deleteDeliveryPrice,
} from "../../helpers/deliveryPricing.js";
import {
  getSpecialOrderSettings,
  updateSpecialOrderSettings,
  calculateSpecialDeliveryFee,
} from "../../helpers/specialOrderSettings.js";
import { getSpecialOrderCustomerFinalConfirmKeyboard } from "../../helpers/specialOrderKeyboards.js";

type AdminStateAction =
  | "add_restaurant"
  | "edit_restaurant_name"
  | "add_food"
  | "edit_food_price"
  | "add_rider"
  | "set_campus_delivery_price"
  | "set_restaurant_delivery_price"
  | "so_admin_set_item_price"
  | "so_admin_set_distance"
  | "so_admin_add_restaurant"
  | "so_admin_add_location"
  | "so_admin_edit_min_fee"
  | "so_admin_edit_price_km"
  | "none";

interface AdminState {
  action?: AdminStateAction;
  restaurantId?: string | number | null;
  foodId?: string | number | null;
  riderId?: string | number | null;
  campusKey?: string;
  soOrderId?: number;
  soItemId?: number;
  soSpecialRestaurantId?: number;
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
      Markup.button.callback("⭐ Special Orders", "admin_special_orders"),
      Markup.button.callback("🏪 Special Restaurants", "admin_special_restaurants"),
      Markup.button.callback("📥 Contract Requests", "admin_contract_requests"),
      Markup.button.callback("💬 Complaints", "admin_complaints"),
      Markup.button.callback("⚙️ Settings", "admin_settings"),
    ],
    { columns: 2 }
  );
}

function formatPhoneLink(phone?: string): string {
  if (!phone) return "N/A";
  return phone.trim();
}

function formatCampusName(campus?: string): string {
  if (!campus) return "N/A";
  return campus
    .replace(/^campus_/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

  bot.hears("🚚 Delivery Pricing", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showDeliveryPricingMenu(ctx);
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
            `✅ Rider *${name}* added!\n\n` +
              `🔑 Activation Code: \`${secretCode}\`\n\n` +
              `Tell the rider to send in Telegram:\n` +
              `\`/activate ${secretCode}\` or just send \`${secretCode}\``,
            { parse_mode: "Markdown" }
          );
          adminStates.delete(adminId);
          await showRidersMenu(ctx);
          break;
        }

        case "set_campus_delivery_price": {
          if (!state.campusKey) break;
          const price = Number(text);
          if (isNaN(price) || price < 0) {
            return ctx.reply("⚠️ Please enter a valid non-negative number for price per food (e.g. 15).");
          }

          await setCampusDeliveryPrice(state.campusKey, price);
          await ctx.reply(
            `✅ Default delivery price for *${formatCampusName(state.campusKey)}* updated to *${price} ETB / food*!`,
            { parse_mode: "Markdown" }
          );
          adminStates.delete(adminId);
          await showCampusPricesMenu(ctx);
          break;
        }

        case "set_restaurant_delivery_price": {
          if (!state.restaurantId || !state.campusKey) break;
          const price = Number(text);
          if (isNaN(price) || price < 0) {
            return ctx.reply("⚠️ Please enter a valid non-negative number for price per food (e.g. 15).");
          }

          await setRestaurantDeliveryPrice(Number(state.restaurantId), state.campusKey, price);
          await ctx.reply(
            `✅ Delivery price override updated to *${price} ETB / food*!`,
            { parse_mode: "Markdown" }
          );
          adminStates.delete(adminId);
          await showRestaurantPricesMenu(ctx);
          break;
        }

        case "so_admin_set_item_price": {
          if (!state.soItemId || !state.soOrderId) break;
          const price = Number(text);
          if (isNaN(price) || price <= 0) {
            return ctx.reply("⚠️ Please enter a valid positive number for price (e.g. 150).");
          }

          const itemRes = await db.execute({
            sql: "SELECT quantity FROM special_order_items WHERE id = ?",
            args: [state.soItemId],
          });
          const qty = Number(itemRes.rows[0]?.quantity || 1);
          const subtotal = price * qty;

          await db.execute({
            sql: "UPDATE special_order_items SET admin_price = ?, final_unit_price = ?, subtotal = ? WHERE id = ?",
            args: [price, price, subtotal, state.soItemId],
          });

          const sumRes = await db.execute({
            sql: "SELECT SUM(subtotal) as food_subtotal FROM special_order_items WHERE special_order_id = ?",
            args: [state.soOrderId],
          });
          const foodSubtotal = Number(sumRes.rows[0]?.food_subtotal || 0);

          const orderRes = await db.execute({
            sql: "SELECT delivery_fee FROM special_orders WHERE id = ?",
            args: [state.soOrderId],
          });
          const delFee = Number(orderRes.rows[0]?.delivery_fee || 0);

          await db.execute({
            sql: "UPDATE special_orders SET food_subtotal = ?, total_price = ? WHERE id = ?",
            args: [foodSubtotal, foodSubtotal + delFee, state.soOrderId],
          });

          const orderId = state.soOrderId;
          adminStates.delete(adminId);
          await ctx.reply("✅ Item price updated successfully!");
          await showSpecialOrderDetails(ctx, orderId);
          break;
        }

        case "so_admin_set_distance": {
          if (!state.soOrderId) break;
          const dist = Number(text);
          if (isNaN(dist) || dist < 0) {
            return ctx.reply("⚠️ Please enter a valid distance in KM (e.g. 4).");
          }

          const settings = await getSpecialOrderSettings();
          const delFee = calculateSpecialDeliveryFee(dist, settings.minDeliveryFee, settings.pricePerKm);

          const orderRes = await db.execute({
            sql: "SELECT food_subtotal FROM special_orders WHERE id = ?",
            args: [state.soOrderId],
          });
          const foodSubtotal = Number(orderRes.rows[0]?.food_subtotal || 0);

          await db.execute({
            sql: `UPDATE special_orders SET
              delivery_distance = ?,
              minimum_delivery_fee = ?,
              price_per_km = ?,
              delivery_fee = ?,
              total_price = ?
              WHERE id = ?`,
            args: [
              dist,
              settings.minDeliveryFee,
              settings.pricePerKm,
              delFee,
              foodSubtotal + delFee,
              state.soOrderId,
            ],
          });

          const orderId = state.soOrderId;
          adminStates.delete(adminId);
          await ctx.reply(`✅ Distance set to ${dist} km. Delivery fee calculated: ${delFee} ETB.`);
          await showSpecialOrderDetails(ctx, orderId);
          break;
        }

        case "so_admin_add_restaurant": {
          if (!text) return ctx.reply("⚠️ Please enter a valid restaurant name.");
          await db.execute({
            sql: "INSERT INTO special_restaurants (name, active) VALUES (?, 1)",
            args: [text],
          });
          adminStates.delete(adminId);
          await ctx.reply(`✅ Special restaurant "${text}" added!`);
          await showSpecialRestaurantsMenu(ctx);
          break;
        }

        case "so_admin_add_location": {
          if (!state.soSpecialRestaurantId || !text) {
            return ctx.reply("⚠️ Please enter a valid location name.");
          }
          await db.execute({
            sql: "INSERT INTO special_restaurant_locations (special_restaurant_id, location_name, active) VALUES (?, ?, 1)",
            args: [state.soSpecialRestaurantId, text],
          });
          const restId = state.soSpecialRestaurantId;
          adminStates.delete(adminId);
          await ctx.reply(`✅ Location "${text}" added!`);
          await showSpecialRestaurantLocations(ctx, restId);
          break;
        }

        case "so_admin_edit_min_fee": {
          const fee = Number(text);
          if (isNaN(fee) || fee < 0) {
            return ctx.reply("⚠️ Please enter a valid positive number for minimum delivery fee.");
          }
          const settings = await getSpecialOrderSettings();
          await updateSpecialOrderSettings(fee, settings.pricePerKm);
          adminStates.delete(adminId);
          await ctx.reply(`✅ Minimum delivery fee updated to ${fee} ETB.`);
          await showSpecialOrderSettingsMenu(ctx);
          break;
        }

        case "so_admin_edit_price_km": {
          const pkm = Number(text);
          if (isNaN(pkm) || pkm < 0) {
            return ctx.reply("⚠️ Please enter a valid positive number for price per KM.");
          }
          const settings = await getSpecialOrderSettings();
          await updateSpecialOrderSettings(settings.minDeliveryFee, pkm);
          adminStates.delete(adminId);
          await ctx.reply(`✅ Price per KM updated to ${pkm} ETB.`);
          await showSpecialOrderSettingsMenu(ctx);
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

  // Contract Approval & Rejection Direct Actions
  bot.action(/^(?:admin_req_approve|approve_contract_req)_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const reqId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (!r) return ctx.reply("⚠️ Contract request not found.");
    if (r.status === "approved") {
      return ctx.editMessageText(`✅ *Contract Request #${reqId} was already approved.*`, { parse_mode: "Markdown" });
    }
    if (r.status === "rejected") {
      return ctx.editMessageText(`❌ *Contract Request #${reqId} was already rejected.*`, { parse_mode: "Markdown" });
    }

    const telegramId = Number(r.telegram_id);

    if (r.request_type === "food_contract") {
      // Check duplicate active contract first
      const hasActive = await hasActiveRestaurantContract(telegramId, r.restaurant_id ? Number(r.restaurant_id) : null);
      if (hasActive) {
        await db.execute({
          sql: "UPDATE contract_requests SET status = 'already_active' WHERE id = ?",
          args: [reqId],
        });
        return ctx.editMessageText(`ℹ️ *Customer already has an active food contract for this restaurant.*`, { parse_mode: "Markdown" });
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
          `🎉 *Food Contract Approved!*\n\nYour food contract request for *${r.restaurant_name || "Restaurant"}* (${DEFAULT_MEAL_ALLOWANCE} meals) has been approved by admin!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    } else {
      // Check duplicate active contract first
      const hasActive = await hasActiveDeliveryContract(telegramId);
      if (hasActive) {
        await db.execute({
          sql: "UPDATE contract_requests SET status = 'already_active' WHERE id = ?",
          args: [reqId],
        });
        return ctx.editMessageText(`ℹ️ *Customer already has an active delivery contract.*`, { parse_mode: "Markdown" });
      }

      await db.execute({
        sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
              VALUES (?, ?, ?, 1)`,
        args: [telegramId, String(r.campus || ""), DEFAULT_DELIVERY_ALLOWANCE],
      });

      try {
        await bot.telegram.sendMessage(
          telegramId,
          `🎉 *Delivery Contract Approved!*\n\nYour delivery contract request (${DEFAULT_DELIVERY_ALLOWANCE} deliveries) has been approved by admin!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    await db.execute({
      sql: "UPDATE contract_requests SET status = 'approved' WHERE id = ?",
      args: [reqId],
    });

    await ctx.editMessageText(`✅ *Contract Request #${reqId} Approved and Activated!*`, { parse_mode: "Markdown" });
  });

  bot.action(/^(?:admin_req_reject|reject_contract_req)_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const reqId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (r && r.telegram_id) {
      try {
        await bot.telegram.sendMessage(
          Number(r.telegram_id),
          `❌ *Contract Request Declined*\n\nYour contract request was declined by admin. Please contact support if you have any questions.`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    }

    await db.execute({
      sql: "UPDATE contract_requests SET status = 'rejected' WHERE id = ?",
      args: [reqId],
    });
    await ctx.editMessageText(`❌ *Contract Request #${reqId} Rejected.*`, { parse_mode: "Markdown" });
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

  // --- DELIVERY PRICING MENU & ACTIONS ---
  async function showDeliveryPricingMenu(ctx: Context) {
    const text =
      `🚚 *Delivery Pricing Management*\n\n` +
      `Manage normal food order delivery prices per food quantity.\n\n` +
      `🏫 *Campus Prices:* Configured default per-food delivery prices for each campus.\n` +
      `🍽️ *Restaurant Prices:* Restaurant-specific per-food delivery price overrides for specific campuses.\n\n` +
      `Please select a section to manage:`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("🏫 Campus Prices", "admin_delivery_campus"),
        Markup.button.callback("🍽️ Restaurant Prices", "admin_delivery_restaurant"),
      ],
      [Markup.button.callback("🔙 Back to Admin", "admin_back")],
    ]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }
  }

  async function showCampusPricesMenu(ctx: Context) {
    const campusPrices = await getCampusDeliveryPrices();
    const campusMap = new Map<string, number>();
    campusPrices.forEach((cp) => campusMap.set(cp.campus, cp.pricePerFood));

    const campusList = [
      { key: "campus_main_boys_whites_house", label: "Main Boys Whites House" },
      { key: "campus_main_boys_africa", label: "Main Boys Africa" },
      { key: "campus_main_girls_white_house", label: "Main Girls White House" },
      { key: "campus_main_girls_africa_house", label: "Main Girls Africa House" },
      { key: "campus_techno_boys", label: "Techno Boys Diaspora" },
      { key: "campus_techno_girls", label: "Techno Girls" },
      { key: "campus_agri", label: "Agri Campus" },
    ];

    let msg = `🏫 *Campus Delivery Prices (Default)*\n\n`;
    msg += `These are the default delivery prices charged *per food quantity* for each campus:\n\n`;

    const buttons: any[] = [];

    for (const c of campusList) {
      const price = campusMap.get(c.key);
      const priceText = price !== undefined ? `${price} ETB / food` : "Not Configured ⚠️";
      msg += `• *${c.label}:* ${priceText}\n`;

      buttons.push([
        Markup.button.callback(
          `✏️ Edit ${c.label} (${price !== undefined ? price + " ETB/food" : "Set"})`,
          `set_campus_dp_${c.key}`
        ),
      ]);
    }

    buttons.push([Markup.button.callback("🔙 Back to Delivery Pricing", "admin_delivery_pricing")]);

    const keyboard = Markup.inlineKeyboard(buttons);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }
  }

  async function showRestaurantPricesMenu(ctx: Context) {
    const restPrices = await getRestaurantDeliveryPrices();

    let msg = `🍽️ *Restaurant Delivery Prices (Overrides)*\n\n`;
    msg += `Configure restaurant-specific delivery prices per food for specific campuses. When set, these override the campus default price.\n\n`;

    const buttons: any[] = [];

    if (restPrices.length === 0) {
      msg += `ℹ️ _No restaurant-specific price overrides currently configured. Campus default prices are being used for all restaurants._\n\n`;
    } else {
      msg += `*Current Restaurant Overrides:*\n`;
      for (const item of restPrices) {
        msg += `• *${item.restaurantName}* → ${formatCampusName(item.campus)}: *${item.pricePerFood} ETB / food*\n`;
        buttons.push([
          Markup.button.callback(
            `🗑️ Remove ${item.restaurantName} (${formatCampusName(item.campus)})`,
            `del_dp_${item.id}`
          ),
        ]);
      }
      msg += `\n`;
    }

    buttons.push([
      Markup.button.callback("➕ Add / Edit Restaurant Override", "admin_add_restaurant_price"),
    ]);
    buttons.push([
      Markup.button.callback("🔙 Back to Delivery Pricing", "admin_delivery_pricing"),
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }
  }

  bot.action("admin_delivery_pricing", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showDeliveryPricingMenu(ctx);
  });

  bot.action("admin_delivery_campus", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showCampusPricesMenu(ctx);
  });

  bot.action("admin_delivery_restaurant", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showRestaurantPricesMenu(ctx);
  });

  bot.action(/^set_campus_dp_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    const campusKey = ctx.match[1];

    adminStates.set(adminId, {
      action: "set_campus_delivery_price",
      campusKey,
    });

    await ctx.reply(
      `✏️ Enter default normal delivery price (*ETB / food*) for *${formatCampusName(campusKey)}*:\n\n(e.g., enter \`15\`)`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action("admin_add_restaurant_price", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;

    const restRes = await db.execute("SELECT id, name FROM restaurants WHERE (active IS NULL OR active = 1) ORDER BY name ASC");
    const restaurants = restRes.rows;

    if (restaurants.length === 0) {
      return ctx.reply("⚠️ No active restaurants found. Please add a restaurant first.");
    }

    const buttons: any[] = [];
    for (const r of restaurants) {
      buttons.push([Markup.button.callback(String(r.name), `sel_rest_dp_${r.id}`)]);
    }
    buttons.push([Markup.button.callback("🔙 Back", "admin_delivery_restaurant")]);

    await ctx.editMessageText("🍽️ *Select a Restaurant for Delivery Price Override:*", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  });

  bot.action(/^sel_rest_dp_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;

    const restaurantId = Number(ctx.match[1]);

    const campusList = [
      { key: "campus_main_boys_whites_house", label: "Main Boys Whites House" },
      { key: "campus_main_boys_africa", label: "Main Boys Africa" },
      { key: "campus_main_girls_white_house", label: "Main Girls White House" },
      { key: "campus_main_girls_africa_house", label: "Main Girls Africa House" },
      { key: "campus_techno_boys", label: "Techno Boys Diaspora" },
      { key: "campus_techno_girls", label: "Techno Girls" },
      { key: "campus_agri", label: "Agri Campus" },
    ];

    const buttons: any[] = [];
    for (const c of campusList) {
      buttons.push([
        Markup.button.callback(`🏫 ${c.label}`, `sel_camp_dp_${restaurantId}_${c.key}`),
      ]);
    }
    buttons.push([Markup.button.callback("🔙 Back", "admin_delivery_restaurant")]);

    await ctx.editMessageText("🏫 *Select a Campus for this Restaurant Override:*", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  });

  bot.action(/^sel_camp_dp_(\d+)_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;

    const adminId = ctx.from!.id;
    const restaurantId = Number(ctx.match[1]);
    const campusKey = ctx.match[2];

    const restRes = await db.execute({
      sql: "SELECT name FROM restaurants WHERE id = ?",
      args: [restaurantId],
    });
    const restName = restRes.rows[0]?.name || "Restaurant";

    adminStates.set(adminId, {
      action: "set_restaurant_delivery_price",
      restaurantId,
      campusKey,
    });

    await ctx.reply(
      `✏️ Enter delivery price (*ETB / food*) for *${restName}* at *${formatCampusName(campusKey)}*:\n\n(e.g., enter \`15\`)`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action(/^del_dp_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;

    const id = Number(ctx.match[1]);
    await deleteDeliveryPrice(id);

    await ctx.reply("✅ Restaurant delivery price override removed.");
    await showRestaurantPricesMenu(ctx);
  });

  // --- SPECIAL ORDERS ADMIN HANDLERS ---
  bot.hears("⭐ Special Orders", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showSpecialOrdersMenu(ctx);
  });

  bot.action("admin_special_orders", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showSpecialOrdersMenu(ctx);
  });

  bot.action(/^so_admin_view_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_view_(\d+)$/);
    if (!match) return;
    await showSpecialOrderDetails(ctx, Number(match[1]));
  });

  bot.action(/^so_admin_set_item_price_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_set_item_price_(\d+)$/);
    if (!match) return;
    const itemId = Number(match[1]);

    const itemRes = await db.execute({
      sql: "SELECT item_name, special_order_id FROM special_order_items WHERE id = ?",
      args: [itemId],
    });
    const item = itemRes.rows[0];
    if (!item) return ctx.reply("⚠️ Item not found.");

    adminStates.set(adminId, {
      action: "so_admin_set_item_price",
      soItemId: itemId,
      soOrderId: Number(item.special_order_id),
    });

    await ctx.reply(
      `💰 Enter confirmed restaurant price for *${escapeMarkdown(String(item.item_name))}* (per unit in ETB):`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action(/^so_admin_set_dist_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_set_dist_(\d+)$/);
    if (!match) return;
    const orderId = Number(match[1]);

    adminStates.set(adminId, {
      action: "so_admin_set_distance",
      soOrderId: orderId,
    });

    await ctx.reply("📏 Enter delivery distance in kilometers (e.g. 4):", {
      parse_mode: "Markdown",
    });
  });

  bot.action(/^so_admin_confirm_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_confirm_(\d+)$/);
    if (!match) return;
    const orderId = Number(match[1]);

    const orderRes = await db.execute({
      sql: "SELECT * FROM special_orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];
    if (!order) return ctx.reply("⚠️ Order not found.");

    const itemsRes = await db.execute({
      sql: "SELECT * FROM special_order_items WHERE special_order_id = ?",
      args: [orderId],
    });
    const items = itemsRes.rows;

    const unpriced = items.find(
      (i: any) => i.final_unit_price === null || i.final_unit_price === undefined || Number(i.final_unit_price || 0) <= 0
    );

    if (unpriced) {
      return ctx.answerCbQuery("⚠️ Cannot confirm: some items have unknown prices!", { show_alert: true });
    }

    const updateRes = await db.execute({
      sql: "UPDATE special_orders SET status = 'admin_confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'",
      args: [orderId],
    });

    if (updateRes.rowsAffected === 1) {
      await ctx.reply(`✅ Special Order #${orderId} confirmed! Sent to customer for final approval.`);

      const itemsListHtml = items
        .map((i: any) => `• <b>${escapeHTML(String(i.item_name))}</b> × ${i.quantity} — ${i.final_unit_price} ETB`)
        .join("\n");

      const custMsgHtml =
        `⭐ <b>Special Order Confirmation</b>\n\n` +
        `👤 <b>Name:</b> ${escapeHTML(String(order.user_name))}\n` +
        `📞 <b>Phone:</b> ${escapeHTML(String(order.phone))}\n` +
        `🏫 <b>Delivery:</b> ${escapeHTML(formatCampusName(String(order.campus)))}\n\n` +
        `🏪 <b>Restaurant:</b> ${escapeHTML(String(order.restaurant_name))}\n` +
        `📍 <b>Restaurant Location:</b> ${escapeHTML(String(order.restaurant_location))}\n\n` +
        `🍔 <b>Items:</b>\n${itemsListHtml}\n\n` +
        `🍽️ <b>Food Total:</b> ${order.food_subtotal} ETB\n` +
        `🚚 <b>Delivery Fee:</b> ${order.delivery_fee} ETB\n\n` +
        `💰 <b>Grand Total: ${order.total_price} ETB</b>`;

      const custKeyboard = getSpecialOrderCustomerFinalConfirmKeyboard(orderId);

      try {
        await bot.telegram.sendMessage(Number(order.telegram_id), custMsgHtml, {
          parse_mode: "HTML",
          reply_markup: custKeyboard.reply_markup,
        });
      } catch (sendErr) {
        console.error(`[AdminHandler] Failed sending final confirmation to customer:`, sendErr);
      }
    } else {
      await ctx.answerCbQuery("⚠️ Order already confirmed or processed.", { show_alert: true });
    }
  });

  bot.action(/^so_admin_reject_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_reject_(\d+)$/);
    if (!match) return;
    const orderId = Number(match[1]);

    const orderRes = await db.execute({
      sql: "SELECT * FROM special_orders WHERE id = ?",
      args: [orderId],
    });
    const order = orderRes.rows[0];
    if (!order) return;

    await db.execute({
      sql: "UPDATE special_orders SET status = 'admin_rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [orderId],
    });

    await ctx.reply(`❌ Special Order #${orderId} rejected.`);

    try {
      await bot.telegram.sendMessage(
        Number(order.telegram_id),
        `❌ *Sorry, your Special Order #${orderId} could not be accepted.*`,
        { parse_mode: "Markdown" }
      );
    } catch (sendErr) {
      console.error(`[AdminHandler] Failed to notify user of rejection:`, sendErr);
    }
  });

  // --- SPECIAL RESTAURANTS ADMIN HANDLERS ---
  bot.hears("🏪 Special Restaurants", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await showSpecialRestaurantsMenu(ctx);
  });

  bot.action("admin_special_restaurants", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showSpecialRestaurantsMenu(ctx);
  });

  bot.action("so_admin_add_restaurant", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    adminStates.set(adminId, { action: "so_admin_add_restaurant" });
    await ctx.reply("🏪 Enter Special Restaurant name:");
  });

  bot.action(/^so_admin_toggle_rest_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_toggle_rest_(\d+)$/);
    if (!match) return;
    const restId = Number(match[1]);

    await db.execute({
      sql: "UPDATE special_restaurants SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?",
      args: [restId],
    });

    await showSpecialRestaurantsMenu(ctx);
  });

  bot.action(/^so_admin_manage_locs_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_manage_locs_(\d+)$/);
    if (!match) return;
    await showSpecialRestaurantLocations(ctx, Number(match[1]));
  });

  bot.action(/^so_admin_add_loc_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_add_loc_(\d+)$/);
    if (!match) return;
    const restId = Number(match[1]);

    adminStates.set(adminId, { action: "so_admin_add_location", soSpecialRestaurantId: restId });
    await ctx.reply("📍 Enter location name for this restaurant:");
  });

  bot.action(/^so_admin_toggle_loc_(\d+)_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const data = getCallbackData(ctx);
    const match = data?.match(/^so_admin_toggle_loc_(\d+)_(\d+)$/);
    if (!match) return;
    const locId = Number(match[1]);
    const restId = Number(match[2]);

    await db.execute({
      sql: "UPDATE special_restaurant_locations SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?",
      args: [locId],
    });

    await showSpecialRestaurantLocations(ctx, restId);
  });

  // --- SPECIAL ORDER SETTINGS ---
  bot.action("admin_so_settings", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    await showSpecialOrderSettingsMenu(ctx);
  });

  bot.action("so_admin_edit_min_fee", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    adminStates.set(adminId, { action: "so_admin_edit_min_fee" });
    await ctx.reply("🚚 Enter new Minimum Delivery Fee (ETB):");
  });

  bot.action("so_admin_edit_price_km", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    if (!(await requireAdmin(ctx))) return;
    const adminId = ctx.from!.id;
    adminStates.set(adminId, { action: "so_admin_edit_price_km" });
    await ctx.reply("📏 Enter new Price Per KM (ETB):");
  });
}

const getCallbackData = (ctx: Context) =>
  (ctx.callbackQuery as { data?: string } | undefined)?.data ?? null;

function escapeHTML(str?: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdown(str?: string): string {
  if (!str) return "";
  return str.replace(/[_*`\[\]]/g, "\\$&");
}

function normalizePhone(phone?: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("09")) {
    cleaned = "+2519" + cleaned.slice(2);
  } else if (cleaned.startsWith("07")) {
    cleaned = "+2517" + cleaned.slice(2);
  } else if (cleaned.startsWith("251")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

async function showSpecialOrdersMenu(ctx: Context) {
  const pendingRes = await db.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE status = 'submitted'");
  const pendingCnt = Number(pendingRes.rows[0]?.cnt || 0);

  const confirmRes = await db.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE status = 'admin_confirmed'");
  const confirmCnt = Number(confirmRes.rows[0]?.cnt || 0);

  const readyRes = await db.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE status = 'ready_for_delivery'");
  const readyCnt = Number(readyRes.rows[0]?.cnt || 0);

  const activeRes = await db.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE status IN ('accepted', 'on_the_way', 'picked_up')");
  const activeCnt = Number(activeRes.rows[0]?.cnt || 0);

  const ordersRes = await db.execute("SELECT id, user_name, restaurant_name, status, total_price, created_at FROM special_orders ORDER BY id DESC LIMIT 15");
  const recentOrders = ordersRes.rows;

  let msgText =
    `⭐ <b>Special Orders Dashboard</b>\n\n` +
    `📥 <b>Pending Review:</b> ${pendingCnt}\n` +
    `📩 <b>Waiting Customer Confirmation:</b> ${confirmCnt}\n` +
    `🚚 <b>Ready for Delivery:</b> ${readyCnt}\n` +
    `🛵 <b>Active Deliveries:</b> ${activeCnt}\n\n` +
    `📋 <b>Recent Special Orders:</b>\n`;

  const buttons: any[] = [];

  if (recentOrders.length > 0) {
    for (const o of recentOrders) {
      msgText += `• <b>#${o.id}</b> ${escapeHTML(String(o.user_name))} — ${escapeHTML(String(o.restaurant_name))} [${o.status}]\n`;
      buttons.push([
        Markup.button.callback(`🔍 View #${o.id} (${o.status})`, `so_admin_view_${o.id}`),
      ]);
    }
  } else {
    msgText += `<i>No special orders created yet.</i>\n`;
  }

  buttons.push([
    Markup.button.callback("🏪 Special Restaurants", "admin_special_restaurants"),
    Markup.button.callback("⚙️ Delivery Settings", "admin_so_settings"),
  ]);

  buttons.push([
    Markup.button.callback("🏠 Admin Menu", "admin_main"),
  ]);

  const keyboard = Markup.inlineKeyboard(buttons);

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(msgText, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      await ctx.reply(msgText, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
      });
    }
  } catch (e) {
    await ctx.reply(msgText, {
      parse_mode: "HTML",
      reply_markup: keyboard.reply_markup,
    });
  }
}

async function showSpecialOrderDetails(ctx: Context, orderId: number) {
  const orderRes = await db.execute({
    sql: "SELECT * FROM special_orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0];
  if (!order) return ctx.reply("⚠️ Special Order not found.");

  const itemsRes = await db.execute({
    sql: "SELECT * FROM special_order_items WHERE special_order_id = ?",
    args: [orderId],
  });
  const items = itemsRes.rows;

  let hasMissingPrice = false;
  const itemsList = items
    .map((i: any) => {
      const isMissing = i.final_unit_price === null || i.final_unit_price === undefined || Number(i.final_unit_price || 0) <= 0;
      if (isMissing) hasMissingPrice = true;
      const p = isMissing ? "⚠️ Price Unknown" : `${i.final_unit_price} ETB`;
      const custP = i.customer_price !== null ? ` (Cust: ${i.customer_price} ETB)` : "";
      return `• <b>${escapeHTML(String(i.item_name))}</b> × ${i.quantity} — ${p}${custP}`;
    })
    .join("\n");

  const statusBadge =
    order.status === "submitted"
      ? "⏳ Waiting for Admin Review"
      : order.status === "admin_confirmed"
      ? "📩 Waiting for Customer Confirmation"
      : order.status === "ready_for_delivery"
      ? "🚚 Ready for Delivery"
      : order.status === "accepted"
      ? "🛵 Accepted by Rider"
      : order.status === "admin_rejected"
      ? "❌ Rejected by Admin"
      : order.status === "customer_cancelled"
      ? "❌ Cancelled by Customer"
      : order.status;

  const msgText =
    `⭐ <b>SPECIAL ORDER #${order.id}</b>\n\n` +
    `👤 <b>Customer:</b> ${escapeHTML(String(order.user_name))}\n` +
    `📞 <b>Phone:</b> <a href="tel:${normalizePhone(String(order.phone))}">${escapeHTML(String(order.phone))}</a>\n` +
    `🏫 <b>Delivery Campus:</b> ${escapeHTML(formatCampusName(String(order.campus)))}\n\n` +
    `🏪 <b>Restaurant:</b> ${escapeHTML(String(order.restaurant_name))}\n` +
    `📍 <b>Restaurant Location:</b> ${escapeHTML(String(order.restaurant_location))}\n\n` +
    `🍔 <b>Items Requested:</b>\n${itemsList}\n\n` +
    `🚚 <b>Delivery Fee Calculation:</b>\n` +
    `• Distance: ${order.delivery_distance ? `${order.delivery_distance} km` : "⚠️ Distance not set"}\n` +
    `• Minimum Fee: ${order.minimum_delivery_fee} ETB\n` +
    `• Price / KM: ${order.price_per_km} ETB\n` +
    `• <b>Calculated Delivery Fee:</b> ${order.delivery_fee} ETB\n\n` +
    `💰 <b>Order Pricing Summary:</b>\n` +
    `• Food Subtotal: ${order.food_subtotal} ETB\n` +
    `• Delivery Fee: ${order.delivery_fee} ETB\n` +
    `• <b>Grand Total: ${order.total_price} ETB</b>\n\n` +
    `📦 <b>Status:</b> ${statusBadge}`;

  const buttons: any[] = [];

  for (const item of items) {
    const isMissing = item.final_unit_price === null || item.final_unit_price === undefined || Number(item.final_unit_price || 0) <= 0;
    if (isMissing) {
      buttons.push([
        Markup.button.callback(
          `💰 Set Price for ${String(item.item_name).slice(0, 15)}`,
          `so_admin_set_item_price_${item.id}`
        ),
      ]);
    }
  }

  buttons.push([
    Markup.button.callback("📏 Set Delivery Distance (KM)", `so_admin_set_dist_${order.id}`),
  ]);

  if (order.status === "submitted") {
    if (!hasMissingPrice && Number(order.delivery_distance) >= 0) {
      buttons.push([
        Markup.button.callback("✅ Confirm Order & Send to Customer", `so_admin_confirm_${order.id}`),
      ]);
    }
    buttons.push([
      Markup.button.callback("❌ Reject Order", `so_admin_reject_${order.id}`),
    ]);
  }

  buttons.push([
    Markup.button.callback("🔙 Back to Special Orders", "admin_special_orders"),
  ]);

  const keyboard = Markup.inlineKeyboard(buttons);

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(msgText, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      await ctx.reply(msgText, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
      });
    }
  } catch (e) {
    await ctx.reply(msgText, {
      parse_mode: "HTML",
      reply_markup: keyboard.reply_markup,
    });
  }
}

async function showSpecialRestaurantsMenu(ctx: Context) {
  const restRes = await db.execute("SELECT * FROM special_restaurants ORDER BY id DESC");
  const rests = restRes.rows;

  let msgText = `🏪 <b>Special Order Restaurants Management</b>\n\n`;
  const buttons: any[] = [
    [Markup.button.callback("➕ Add Special Restaurant", "so_admin_add_restaurant")],
  ];

  if (rests.length > 0) {
    for (const r of rests) {
      const activeStr = r.active ? "🟢 Active" : "🔴 Inactive";
      msgText += `• <b>${escapeHTML(String(r.name))}</b> (${activeStr})\n`;
      buttons.push([
        Markup.button.callback(`📍 Locations for ${String(r.name).slice(0, 12)}`, `so_admin_manage_locs_${r.id}`),
        Markup.button.callback(r.active ? "🔴 Deactivate" : "🟢 Activate", `so_admin_toggle_rest_${r.id}`),
      ]);
    }
  } else {
    msgText += `<i>No special restaurants registered.</i>\n`;
  }

  buttons.push([
    Markup.button.callback("🔙 Back to Special Orders", "admin_special_orders"),
  ]);

  const keyboard = Markup.inlineKeyboard(buttons);
  await ctx.reply(msgText, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
}

async function showSpecialRestaurantLocations(ctx: Context, restId: number) {
  const restRes = await db.execute({ sql: "SELECT * FROM special_restaurants WHERE id = ?", args: [restId] });
  const rest = restRes.rows[0];
  if (!rest) return ctx.reply("⚠️ Special restaurant not found.");

  const locRes = await db.execute({
    sql: "SELECT * FROM special_restaurant_locations WHERE special_restaurant_id = ? ORDER BY id DESC",
    args: [restId],
  });
  const locs = locRes.rows;

  let msgText = `📍 <b>Locations for ${escapeHTML(String(rest.name))}</b>\n\n`;
  const buttons: any[] = [
    [Markup.button.callback(`➕ Add Location to ${String(rest.name).slice(0, 12)}`, `so_admin_add_loc_${restId}`)],
  ];

  if (locs.length > 0) {
    for (const l of locs) {
      const activeStr = l.active ? "🟢 Active" : "🔴 Inactive";
      msgText += `• <b>${escapeHTML(String(l.location_name))}</b> (${activeStr})\n`;
      buttons.push([
        Markup.button.callback(`Toggle ${String(l.location_name).slice(0, 12)}`, `so_admin_toggle_loc_${l.id}_${restId}`),
      ]);
    }
  } else {
    msgText += `<i>No locations configured yet.</i>\n`;
  }

  buttons.push([
    Markup.button.callback("🔙 Back to Special Restaurants", "admin_special_restaurants"),
  ]);

  const keyboard = Markup.inlineKeyboard(buttons);
  await ctx.reply(msgText, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
}

async function showSpecialOrderSettingsMenu(ctx: Context) {
  const settings = await getSpecialOrderSettings();

  const msgText =
    `⚙️ <b>Special Order Delivery Pricing Settings</b>\n\n` +
    `• <b>Minimum Delivery Fee:</b> ${settings.minDeliveryFee} ETB\n` +
    `• <b>Price Per KM:</b> ${settings.pricePerKm} ETB\n\n` +
    `Formula: <code>Delivery Fee = Minimum Fee + (Distance × Price Per KM)</code>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✏️ Edit Minimum Fee", "so_admin_edit_min_fee")],
    [Markup.button.callback("✏️ Edit Price / KM", "so_admin_edit_price_km")],
    [Markup.button.callback("🔙 Back to Special Orders", "admin_special_orders")],
  ]);

  await ctx.reply(msgText, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
}
