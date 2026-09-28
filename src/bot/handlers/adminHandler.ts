import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";

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

function adminMainKeyboard() {
  return Markup.inlineKeyboard(
    [
      Markup.button.callback("🍽 Restaurants", "admin_restaurants"),
      Markup.button.callback("🍔 Foods", "admin_foods"),
      Markup.button.callback("👤 Riders", "admin_riders"),
      Markup.button.callback("📋 Orders", "admin_orders"),
      Markup.button.callback("📥 Requests", "admin_contract_requests"),
      Markup.button.callback("💬 Complaints", "admin_complaints"),
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

  bot.action("admin_back", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    await ctx.editMessageText("*👋 Welcome to Admin Panel*", {
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
          await db.execute({
            sql: "INSERT INTO restaurants (name) VALUES (?)",
            args: [text],
          });
          await ctx.reply(`✅ Restaurant "${text}" added!`);
          adminStates.delete(adminId);
          break;
        }

        case "edit_restaurant": {
          if (!state.restaurantId) break;
          await db.execute({
            sql: "UPDATE restaurants SET name = ? WHERE id = ?",
            args: [text, Number(state.restaurantId)],
          });
          await ctx.reply("✏️ Restaurant name updated.");
          adminStates.delete(adminId);
          break;
        }

        case "add_food": {
          if (!state.restaurantId) break;
          const [name, priceStr] = text.split("|").map((p) => p.trim());
          const price = Number(priceStr);
          if (!name || isNaN(price)) return ctx.reply("⚠️ Use format: Name | Price (e.g. Shiro | 120)");

          await db.execute({
            sql: "INSERT INTO foods (restaurant_id, name, price) VALUES (?, ?, ?)",
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

        case "add_rider": {
          const [name, phone, campus] = text.split("|").map((s) => s.trim());
          if (!name || !phone || !campus) {
            return ctx.reply("⚠️ Format: Name | Phone | Campus (e.g. Abebe | 0912345678 | Techno)");
          }

          const secretCode = generateSecretCode();
          await db.execute({
            sql: "INSERT INTO riders (name, phone, campus, secret_code, active) VALUES (?, ?, ?, ?, 1)",
            args: [name, phone, campus, secretCode],
          });

          await ctx.reply(
            `✅ Rider *${name}* added!\nActivation Code: \`${secretCode}\`\nTell rider to run:\n\`/activate ${secretCode}\``,
            { parse_mode: "Markdown" }
          );
          adminStates.delete(adminId);
          break;
        }

        default:
          return next();
      }
    } catch (err) {
      console.error("Admin text handler error:", err);
      ctx.reply("❌ Error processing admin request.");
    }
  });

  // Admin Restaurants
  bot.action("admin_restaurants", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute("SELECT id, name FROM restaurants ORDER BY id ASC");
    const restaurants = res.rows;

    const rows: any[] = restaurants.map((r: any) => [
      Markup.button.callback(`${r.name}`, `admin_rest_view_${r.id}`),
    ]);

    rows.push([Markup.button.callback("➕ Add Restaurant", "admin_add_restaurant")]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText("🍽 *Restaurants Management:*", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action("admin_add_restaurant", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    adminStates.set(ctx.from!.id, { action: "add_restaurant" });
    await ctx.reply("✏️ Type the name of the new restaurant:");
  });

  // Admin Foods
  bot.action("admin_foods", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute("SELECT id, name FROM restaurants ORDER BY name ASC");
    const restaurants = res.rows;

    const rows = restaurants.map((r: any) => [
      Markup.button.callback(`${r.name}`, `admin_foods_for_${r.id}`),
    ]);
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText("🍔 *Select a restaurant to manage foods:*", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_foods_for_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const restId = Number(ctx.match[1]);
    const foodsRes = await db.execute({
      sql: "SELECT id, name, price FROM foods WHERE restaurant_id = ? ORDER BY name ASC",
      args: [restId],
    });

    const rows = foodsRes.rows.map((f: any) => [
      Markup.button.callback(`🍱 ${f.name} (${f.price} ETB)`, `admin_food_view_${f.id}`),
    ]);

    rows.push([Markup.button.callback("➕ Add New Food Item", `admin_add_food_to_${restId}`)]);
    rows.push([Markup.button.callback("🔙 Back", "admin_foods")]);

    await ctx.editMessageText(`🍔 *Manage Food Items:*`, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_add_food_to_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const restId = Number(ctx.match[1]);
    adminStates.set(ctx.from!.id, { action: "add_food", restaurantId: restId });
    await ctx.reply("✏️ Type food details in format: `Name | Price`\nExample: `Special Shiro | 120`", { parse_mode: "Markdown" });
  });

  // Admin Riders
  bot.action("admin_riders", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute("SELECT id, name, phone, campus, secret_code, active FROM riders ORDER BY name ASC");
    const riders = res.rows;

    let text = "🛵 *Riders Directory:*\n\n";
    if (riders.length === 0) text += "No riders registered yet.\n";
    else {
      riders.forEach((r: any, i: number) => {
        text += `${i + 1}. *${r.name}* (📱 ${r.phone}) — Campus: ${r.campus}\nCode: \`${r.secret_code}\` | Active: ${r.active ? "Yes" : "No"}\n\n`;
      });
    }

    const rows = [
      [Markup.button.callback("➕ Add Rider", "admin_add_rider")],
      [Markup.button.callback("🔙 Back", "admin_back")],
    ];

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action("admin_add_rider", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    adminStates.set(ctx.from!.id, { action: "add_rider" });
    await ctx.reply("✏️ Type rider details in format:\n`Name | Phone | Campus`\nExample: `Bekele | 0912345678 | Techno`", { parse_mode: "Markdown" });
  });

  // Admin Orders
  bot.action("admin_orders", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute("SELECT id, user_name, phone, restaurant, total_price, status FROM orders ORDER BY id DESC LIMIT 20");
    const orders = res.rows;

    let text = "📋 *Recent Orders:*\n\n";
    if (orders.length === 0) text += "No orders placed yet.\n";
    else {
      orders.forEach((o: any, i: number) => {
        text += `${i + 1}. *Order #${o.id}* — ${o.user_name} (${o.restaurant})\nTotal: ${o.total_price} ETB | Status: *${o.status}*\n\n`;
      });
    }

    const rows = [[Markup.button.callback("🔙 Back", "admin_back")]];
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  // Contract Requests Management (Requirement 10)
  bot.action("admin_contract_requests", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute({
      sql: "SELECT id, user_name, phone, campus, request_type, restaurant_name, status, created_at FROM contract_requests ORDER BY id DESC LIMIT 20",
      args: [],
    });
    const requests = res.rows;

    if (requests.length === 0) {
      return ctx.editMessageText(
        "📥 *Contract Requests*\n\n📂 No pending requests.",
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]).reply_markup,
        }
      );
    }

    const rows = requests.map((r: any) => {
      const typeLabel = r.request_type === "food_contract" ? "🍱 Food" : "🚚 Delivery";
      return [
        Markup.button.callback(
          `[${typeLabel}] ${r.user_name} (${r.status || "pending"})`,
          `admin_req_view_${r.id}`
        ),
      ];
    });
    rows.push([Markup.button.callback("🔙 Back", "admin_back")]);

    await ctx.editMessageText("📥 *Contract Requests:*", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_req_view_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const reqId = Number(ctx.match[1]);
    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (!r) return ctx.reply("⚠️ Request not found.");

    const typeLabel = r.request_type === "food_contract" ? "🍱 Food Contract" : "🚚 Delivery Contract";

    const detailText =
      `📥 *Contract Request Details*\n\n` +
      `🆔 *Request ID:* #${r.id}\n` +
      `📋 *Type:* ${typeLabel}\n` +
      `👤 *Customer Name:* ${r.user_name}\n` +
      `📞 *Phone:* ${r.phone}\n` +
      `🏫 *Campus:* ${r.campus || "N/A"}\n` +
      `${r.request_type === "food_contract" ? `🏢 *Restaurant:* ${r.restaurant_name}\n` : ""}` +
      `📦 *Status:* ${r.status}\n` +
      `🕒 *Date:* ${r.created_at ? new Date(String(r.created_at)).toLocaleString() : "Recent"}`;

    const rows = [
      [
        Markup.button.callback("✅ Approve Contract", `admin_req_approve_${r.id}`),
        Markup.button.callback("❌ Reject", `admin_req_reject_${r.id}`),
      ],
      [Markup.button.callback("🔙 Back to Requests", "admin_contract_requests")],
    ];

    await ctx.editMessageText(detailText, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard(rows).reply_markup,
    });
  });

  bot.action(/^admin_req_approve_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const reqId = Number(ctx.match[1]);

    const res = await db.execute({
      sql: "SELECT * FROM contract_requests WHERE id = ?",
      args: [reqId],
    });
    const r = res.rows[0];

    if (!r) return ctx.reply("⚠️ Request not found.");

    if (r.request_type === "food_contract") {
      await db.execute({
        sql: `INSERT INTO restaurant_contracts (telegram_id, restaurant_id, restaurant_name, remaining_meals, is_active)
              VALUES (?, ?, ?, 30, 1)`,
        args: [
          Number(r.telegram_id),
          r.restaurant_id ? Number(r.restaurant_id) : null,
          String(r.restaurant_name || "Custom Restaurant"),
        ],
      });

      try {
        await bot.telegram.sendMessage(
          Number(r.telegram_id),
          `✅ *Food Contract Approved!*\n\nYour food contract request for *${r.restaurant_name}* has been approved by admin!`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    } else {
      await db.execute({
        sql: `INSERT INTO delivery_contracts (telegram_id, campus, remaining_deliveries, is_active)
              VALUES (?, ?, 30, 1)`,
        args: [Number(r.telegram_id), String(r.campus || "")],
      });

      try {
        await bot.telegram.sendMessage(
          Number(r.telegram_id),
          `✅ *Delivery Contract Approved!*\n\nYour delivery contract request has been approved by admin!`,
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
    const reqId = Number(ctx.match[1]);
    await db.execute({
      sql: "UPDATE contract_requests SET status = 'rejected' WHERE id = ?",
      args: [reqId],
    });
    await ctx.editMessageText(`❌ Request #${reqId} marked as rejected.`);
  });

  // Admin Complaints
  bot.action("admin_complaints", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const res = await db.execute("SELECT * FROM complaints ORDER BY id DESC LIMIT 20");
    const complaints = res.rows;

    if (complaints.length === 0) {
      return ctx.editMessageText("💬 *User Complaints*\n\n📂 No complaints submitted yet.", {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]).reply_markup,
      });
    }

    const list = complaints
      .map(
        (c: any, index: number) =>
          `*${index + 1}. 👤 ${c.user_name}* (📞 ${c.user_phone})\n💬 ${c.message}\n🕒 ${c.created_at ? new Date(c.created_at).toLocaleString() : "Recently"}`
      )
      .join("\n\n---\n\n");

    await ctx.editMessageText(`💬 *User Complaints (Latest ${complaints.length})*\n\n${list}`, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]).reply_markup,
    });
  });

  // Admin Dashboard
  bot.action("admin_dashboard", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const [rRes, fRes, rdRes, oRes, reqRes] = await Promise.all([
      db.execute("SELECT COUNT(*) as count FROM restaurants"),
      db.execute("SELECT COUNT(*) as count FROM foods"),
      db.execute("SELECT COUNT(*) as count FROM riders"),
      db.execute("SELECT COUNT(*) as count FROM orders"),
      db.execute("SELECT COUNT(*) as count FROM contract_requests"),
    ]);

    const text =
      `📊 *Admin Dashboard*\n\n` +
      `🍽 Restaurants: ${rRes.rows[0]?.count ?? 0}\n` +
      `🍔 Foods: ${fRes.rows[0]?.count ?? 0}\n` +
      `🛵 Riders: ${rdRes.rows[0]?.count ?? 0}\n` +
      `🧾 Orders: ${oRes.rows[0]?.count ?? 0}\n` +
      `📥 Contract Requests: ${reqRes.rows[0]?.count ?? 0}`;

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "admin_back")]]).reply_markup,
    });
  });

  console.log("[ADMIN] setupAdminHandler initialized");
}
