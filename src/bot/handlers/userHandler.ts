import { Telegraf, Context, Markup } from "telegraf";
import { db } from "../../config/db.js";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  customerMenuKeyboard,
  riderMenuKeyboard,
  adminReplyKeyboard,
  getHelpMenuKeyboard,
  campusKeyboard,
  getRestaurantKeyboard,
  getFoodKeyboard,
  mealTypeKeyboard,
  restaurantContractKeyboard,
  deliveryContractKeyboard,
  quantityKeyboard,
  confirmKeyboard,
} from "../../helpers/keyboards.js";
import { COMPANY_CONTACT } from "../../config/company.js";
import { checkRestaurantContract, checkDeliveryContract } from "../../helpers/contracts.js";
import { getUserRole } from "../../helpers/roles.js";
import { getApplicableDeliveryPrice } from "../../helpers/deliveryPricing.js";

function isTextMessage(msg: any): msg is { text: string } {
  return msg && typeof msg.text === "string";
}

function isContactMessage(msg: any): msg is { contact: { phone_number: string } } {
  return msg && msg.contact && typeof msg.contact.phone_number === "string";
}

const getCallbackData = (ctx: Context) =>
  (ctx.callbackQuery as { data?: string } | undefined)?.data ?? null;

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

function escapeMarkdown(str?: string): string {
  if (!str) return "";
  return str.replace(/[_*`\[\]]/g, "\\$&");
}

function escapeHTML(str?: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

export function handleUserFlow(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[]
) {
  bot.on("message", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const role = await getUserRole(userId);
      const msg = ctx.message;
      if (!msg || !("text" in msg || "contact" in msg)) return;
      if ("text" in msg && msg.text.startsWith("/")) return;

      // Handle role-specific main menu button
      if ("text" in msg && msg.text === "🏠 Main Menu") {
        resetUserState(userId);
        if (role === "admin") {
          return ctx.reply("🏠 *Admin Main Menu*", {
            parse_mode: "Markdown",
            ...adminReplyKeyboard,
          });
        }
        if (role === "rider") {
          return ctx.reply("🏠 *Rider Main Menu*", {
            parse_mode: "Markdown",
            ...riderMenuKeyboard,
          });
        }
        return ctx.reply("🏠 *Main Menu*", {
          parse_mode: "Markdown",
          ...customerMenuKeyboard,
        });
      }

      // If user is Admin or Rider and sending text non-ordering messages, let their respective handlers deal with it
      if (role === "admin" || role === "rider") {
        return;
      }

      let state = userState.get(userId);
      if (!state) {
        const profRes = await db.execute({
          sql: "SELECT name, phone, campus FROM profiles WHERE telegram_id = ?",
          args: [userId],
        });
        const profile = profRes.rows[0];

        state = {
          step: profile ? "idle" : "profile_ask_name",
          name: profile ? String(profile.name) : "",
          phone: profile ? String(profile.phone) : "",
          campus: profile ? String(profile.campus || "") : "",
          foods: [],
          cartFoods: [],
        };
        userState.set(userId, state);
      }

      if (state.step === "profile_ask_name" && isTextMessage(msg)) {
        state.name = msg.text.trim();
        state.step = "profile_ask_phone";
        userState.set(userId, state);

        return ctx.reply(
          `📞 Thank you, *${state.name}*! Please share your phone number to complete registration:`,
          {
            parse_mode: "Markdown",
            ...Markup.keyboard([
              Markup.button.contactRequest("📱 Share Phone"),
            ]).resize(),
          }
        );
      }

      if (
        state.step === "profile_ask_phone" &&
        (isContactMessage(msg) || isTextMessage(msg))
      ) {
        const phone = isContactMessage(msg)
          ? msg.contact.phone_number
          : (msg as any).text.trim();
        state.phone = phone;
        state.step = "idle";
        userState.set(userId, state);

        await db.execute({
          sql: `INSERT INTO profiles (telegram_id, name, phone, campus)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name, phone=excluded.phone;`,
          args: [userId, state.name || "User", state.phone || "", state.campus || ""],
        });

        return ctx.reply(
          `👋 *Welcome to Campus Food Delivery, ${state.name}!*\n\n` +
            `🎉 Registration complete! You can now browse food, view past orders, or contact support using the buttons below.`,
          {
            parse_mode: "Markdown",
            ...customerMenuKeyboard,
          }
        );
      }

      if (state.step === "custom_restaurant_name" && isTextMessage(msg)) {
        state.restaurant = msg.text.trim();
        state.restaurantId = undefined;
        state.step = "ask_restaurant_contract";

        return ctx.reply(
          `*${state.restaurant}*\n\nDo you have a food contract with this restaurant?`,
          {
            parse_mode: "Markdown",
            reply_markup: restaurantContractKeyboard.reply_markup,
          }
        );
      }

      if (state.step === "custom_food_name" && isTextMessage(msg)) {
        state.currentFood = msg.text.trim();
        state.step = "ask_custom_price";

        return ctx.reply(
          `💲 Enter the price for *${state.currentFood}* (e.g. 150):`,
          { parse_mode: "Markdown" }
        );
      }

      if (state.step === "ask_custom_price" && isTextMessage(msg)) {
        const price = Number(msg.text.trim());
        if (isNaN(price) || price < 0) {
          return ctx.reply("⚠️ Invalid price. Please enter a valid number (e.g. 150).");
        }

        state.currentFoodPrice = price;
        state.step = "waiting_for_quantity";

        return ctx.reply(
          `🔢 How many *${state.currentFood}* would you like?`,
          {
            parse_mode: "Markdown",
            reply_markup: quantityKeyboard.reply_markup,
          }
        );
      }

      if (state.step === "waiting_for_custom_quantity" && isTextMessage(msg)) {
        const quantity = Number(msg.text.trim());
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
          return ctx.reply("⚠️ Invalid quantity. Please enter a whole number between 1 and 50.");
        }

        state.foods.push({
          name: state.currentFood!,
          quantity,
          price: state.currentFoodPrice!,
        });

        state.currentFood = undefined;
        state.currentFoodPrice = undefined;
        state.step = "select_food";

        const foodKb = await getFoodKeyboard(state.restaurantId);
        return ctx.reply(
          `✅ Added! Select another food item or press ✅ Done Selecting Foods.`,
          { reply_markup: foodKb.reply_markup }
        );
      }

      if (state.step === "waiting_for_complaint" && isTextMessage(msg)) {
        const complaintText = msg.text.trim();
        state.step = "idle";
        userState.set(userId, state);

        try {
          const userName = state.name || ctx.from?.first_name || "Customer";
          const userPhone = state.phone || "N/A";

          await db.execute({
            sql: "INSERT INTO complaints (telegram_id, user_name, user_phone, message, status) VALUES (?, ?, ?, ?, 'pending')",
            args: [userId, userName, userPhone, complaintText],
          });

          const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(id => Number(id.trim())).filter(id => !isNaN(id));
          for (const adminId of adminIds) {
            try {
              await bot.telegram.sendMessage(
                adminId,
                `⚠️ *New Complaint Received*\n\n` +
                  `👤 *User:* ${userName} (${userId})\n` +
                  `📞 *Phone:* ${formatPhoneLink(userPhone)}\n` +
                  `💬 *Complaint:* ${complaintText}`,
                { parse_mode: "Markdown" }
              );
            } catch (err) {
              console.error(`Failed to notify admin ${adminId}:`, err);
            }
          }

          return ctx.reply(
            "✅ Thank you! Your complaint has been submitted to the organization.",
            customerMenuKeyboard
          );
        } catch (err) {
          console.error("Complaint handling error:", err);
          return ctx.reply(
            "✅ Thank you! Your complaint has been submitted.",
            customerMenuKeyboard
          );
        }
      }

      if (isTextMessage(msg)) {
        switch (msg.text) {
          case "🍽️ Order Food":
          case "🍔 Order Food": {
            state.step = "profile_ask_campus";
            state.foods = [];
            state.hasRestaurantContract = false;
            state.hasDeliveryContract = false;
            state.isSubmittingOrder = false;

            return ctx.reply("🏫 Select your campus:", campusKeyboard);
          }

          case "📦 My Orders": {
            const res = await db.execute({
              sql: "SELECT * FROM orders WHERE telegram_id = ? ORDER BY id DESC LIMIT 20",
              args: [userId],
            });
            const orders = res.rows;

            if (orders.length === 0) {
              return ctx.reply("📂 You have no past orders.");
            }

            const ordersList = orders
              .map(
                (o: any, index: number) =>
                  `*${index + 1}. 🆔 Order #${o.id}*\n` +
                  `🏢 ${o.restaurant}\n` +
                  `💰 Total: ${o.total_price} ETB\n` +
                  `📦 Status: *${o.status}*\n` +
                  `🕒 ${o.created_at ? new Date(o.created_at).toLocaleString() : "Recent"}`
              )
              .join("\n\n");

            return ctx.reply(
              `📂 *Your Order History*\n\n${ordersList}`,
              { parse_mode: "Markdown" }
            );
          }

          case "⭐ Special Order":
          case "⭐ Favorite Orders":
            return ctx.reply(
              "⭐ *Special Order*\n\nSpecial orders will be available here soon.",
              { parse_mode: "Markdown" }
            );

          case "❓ Help":
          case "ℹ️ Help":
            return ctx.reply(
              "📝 *Help Menu*\n\nPlease select an option below:",
              getHelpMenuKeyboard()
            );

          case "👤 My Profile": {
            const res = await db.execute({
              sql: "SELECT name, phone, campus FROM profiles WHERE telegram_id = ?",
              args: [userId],
            });
            const profile = res.rows[0];

            const name = String(profile?.name || state.name || ctx.from?.first_name || "N/A");
            const phone = String(profile?.phone || state.phone || "N/A");
            const campus = String(profile?.campus || state.campus || "N/A");

            const delContract = await checkDeliveryContract(userId);
            const foodContractsRes = await db.execute({
              sql: "SELECT restaurant_name, remaining_meals FROM restaurant_contracts WHERE telegram_id = ? AND is_active = 1 AND remaining_meals > 0",
              args: [userId],
            });

            let contractText = "🎫 *Active Contracts:*\n";
            if (delContract) {
              contractText += `• 🚚 *Delivery Contract:* *${delContract.remaining_deliveries} deliveries remaining*\n`;
            } else {
              contractText += `• 🚚 *Delivery Contract:* None / No active contract\n`;
            }

            if (foodContractsRes.rows.length > 0) {
              foodContractsRes.rows.forEach((fc: any) => {
                contractText += `• 🍽️ *Food Contract (${fc.restaurant_name}):* *${fc.remaining_meals} meals remaining*\n`;
              });
            } else {
              contractText += `• 🍽️ *Food Contract:* None / No active contract\n`;
            }

            return ctx.reply(
              `👤 *My Profile*\n\n` +
                `👤 *Name:* ${name}\n` +
                `📞 *Phone:* ${formatPhoneLink(phone)}\n` +
                `🏫 *Campus:* ${formatCampusName(campus)}\n\n` +
                `${contractText}`,
              { parse_mode: "Markdown" }
            );
          }

          case "📞 Contact Us":
            return ctx.reply(
              `📞 *Contact Us*\n\n` +
                `🏢 *${COMPANY_CONTACT.name}*\n` +
                `📱 *Phone:* ${COMPANY_CONTACT.phone}\n` +
                `💬 *Telegram:* ${COMPANY_CONTACT.telegram}\n\n` +
                `Feel free to reach out if you have any questions or need support!`,
              { parse_mode: "Markdown" }
            );

          case "💬 Complaint":
          case "Complian":
          case "Complaint":
            state.step = "waiting_for_complaint";
            userState.set(userId, state);
            return ctx.reply(
              "✍️ *Submit a Complaint*\n\nPlease type your complaint or feedback for the organization:",
              { parse_mode: "Markdown" }
            );

          default:
            return ctx.reply(
              "🤔 Command not recognized. Use the buttons below or /start to restart.",
              customerMenuKeyboard
            );
        }
      }
    } catch (err) {
      console.error("User message error:", err);
      return ctx.reply("⚠️ Something went wrong. Please try again.");
    }
  });

  // Campus selection callback
  bot.action(/^campus_(.+)/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    let state = userState.get(userId);
    if (!state) {
      state = {
        step: "idle",
        name: ctx.from?.first_name || "User",
        phone: "",
        campus: data,
        foods: [],
        cartFoods: [],
      };
      userState.set(userId, state);
    }

    state.campus = data;
    state.step = "ask_restaurant";

    await db.execute({
      sql: `INSERT INTO profiles (telegram_id, name, phone, campus)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET campus=excluded.campus;`,
      args: [userId, state.name || "User", state.phone || "", String(state.campus || "")],
    });

    const restaurantKeyboard = await getRestaurantKeyboard();

    await ctx.editMessageText("*Choose a restaurant:*", {
      parse_mode: "Markdown",
      reply_markup: restaurantKeyboard.reply_markup,
    });
  });

  bot.action("back_to_campus", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (state) state.step = "profile_ask_campus";

    await ctx.editMessageText("🏫 *Select your campus:*", {
      parse_mode: "Markdown",
      reply_markup: campusKeyboard.reply_markup,
    });
  });

  // Restaurant selection
  bot.action(/^restaurant_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    const restaurantId = Number(data.replace("restaurant_", ""));
    state.restaurantId = String(restaurantId);

    const res = await db.execute({
      sql: "SELECT id, name FROM restaurants WHERE id = ?",
      args: [restaurantId],
    });
    const restaurant = res.rows[0];

    if (!restaurant) {
      return ctx.reply("⚠️ Restaurant not found.");
    }

    state.restaurant = String(restaurant.name);
    state.step = "ask_restaurant_contract";

    await ctx.editMessageText(
      `*${restaurant.name}*\n\nDo you have a food contract with this restaurant?`,
      {
        parse_mode: "Markdown",
        reply_markup: restaurantContractKeyboard.reply_markup,
      }
    );
  });

  // Custom restaurant
  bot.action("custom_restaurant", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.step = "custom_restaurant_name";
    state.restaurant = undefined;

    await ctx.reply("✏️ Please type the name of your restaurant:");
  });

  // Restaurant Food Contract choice
  bot.action("rest_contract_yes", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    const contract = await checkRestaurantContract(
      userId,
      state.restaurantId,
      state.restaurant
    );

    if (contract) {
      state.hasRestaurantContract = true;
      state.step = "select_meal_type";

      await ctx.editMessageText(
        `✅ *Food contract verified for ${state.restaurant}!*\n\nPlease select meal type:`,
        {
          parse_mode: "Markdown",
          reply_markup: mealTypeKeyboard.reply_markup,
        }
      );
    } else {
      state.hasRestaurantContract = false;
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("📩 Request Food Contract", "req_rest_contract")],
        [Markup.button.callback("Continue without Contract", "continue_no_rest_contract")],
      ]);

      await ctx.editMessageText(
        `⚠️ *You do not have an active food contract with ${state.restaurant || "this restaurant"}.*`,
        {
          parse_mode: "Markdown",
          reply_markup: kb.reply_markup,
        }
      );
    }
  });

  bot.action("rest_contract_no", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.hasRestaurantContract = false;
    state.step = "select_meal_type";

    await ctx.editMessageText(
      `*${state.restaurant || "Selected Restaurant"}*\n\nPlease select meal type:`,
      {
        parse_mode: "Markdown",
        reply_markup: mealTypeKeyboard.reply_markup,
      }
    );
  });

  bot.action("continue_no_rest_contract", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.hasRestaurantContract = false;
    state.step = "select_meal_type";

    await ctx.editMessageText(
      `*${state.restaurant || "Selected Restaurant"}*\n\nPlease select meal type:`,
      {
        parse_mode: "Markdown",
        reply_markup: mealTypeKeyboard.reply_markup,
      }
    );
  });

  bot.action("req_rest_contract", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    try {
      const usernameTag = ctx.from?.username ? `@${ctx.from.username}` : "N/A";

      const insertRes = await db.execute({
        sql: `INSERT INTO contract_requests (telegram_id, user_name, username, phone, campus, request_type, restaurant_id, restaurant_name, status)
              VALUES (?, ?, ?, ?, ?, 'food_contract', ?, ?, 'pending')
              RETURNING id`,
        args: [
          userId,
          state.name || ctx.from?.first_name || "User",
          usernameTag,
          state.phone || "",
          state.campus || "",
          state.restaurantId ? Number(state.restaurantId) : null,
          state.restaurant || "Custom Restaurant",
        ],
      });

      const reqId = Number(insertRes.rows[0]?.id);

      const adminMsgText =
        `📥 *New Food Contract Request*\n\n` +
        `👤 *Name:* ${escapeMarkdown(state.name || "User")}\n` +
        `📞 *Phone:* ${escapeMarkdown(formatPhoneLink(state.phone))}\n` +
        `🏫 *Campus:* ${escapeMarkdown(formatCampusName(state.campus))}\n` +
        `🏢 *Restaurant:* ${escapeMarkdown(state.restaurant || "N/A")}\n` +
        `🆔 *Telegram ID:* \`${userId}\`\n` +
        `👤 *Username:* ${escapeMarkdown(usernameTag)}`;

      const adminKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Confirm / Approve", `admin_req_approve_${reqId}`),
          Markup.button.callback("❌ Cancel / Reject", `admin_req_reject_${reqId}`),
        ],
      ]);

      const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(id => Number(id.trim())).filter(id => !isNaN(id));
      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, adminMsgText, {
            parse_mode: "Markdown",
            reply_markup: adminKeyboard.reply_markup,
          });
        } catch (e) {}
      }

      state.hasRestaurantContract = false;
      state.step = "select_meal_type";

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("➡️ Continue Ordering", "continue_no_rest_contract")],
      ]);

      await ctx.editMessageText(
        `📩 *Your Food Contract Request for ${state.restaurant} has been submitted!*\n\nOur admin team will review it. You can continue ordering without a contract for now:`,
        {
          parse_mode: "Markdown",
          reply_markup: kb.reply_markup,
        }
      );
    } catch (err) {
      console.error("Request food contract error:", err);
      ctx.reply("❌ Failed to submit contract request.");
    }
  });

  // Meal Type Selection (Lunch / Dinner only)
  bot.action(/^meal_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    const mealType = data.replace("meal_", "");
    state.mealType = mealType;
    state.step = "select_food";

    const foodKb = await getFoodKeyboard(state.restaurantId);

    await ctx.editMessageText(
      `🍱 *${state.restaurant} (${mealType === "lunch" ? "🥗 Lunch" : "🌙 Dinner"})*\n\nSelect a food item:`,
      {
        parse_mode: "Markdown",
        reply_markup: foodKb.reply_markup,
      }
    );
  });

  bot.action("back_to_restaurants", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (state) state.step = "ask_restaurant";

    const restaurantKeyboard = await getRestaurantKeyboard();
    await ctx.editMessageText("*Choose a restaurant:*", {
      parse_mode: "Markdown",
      reply_markup: restaurantKeyboard.reply_markup,
    });
  });

  // Food Item Click
  bot.action(/^food_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    const foodId = Number(data.replace("food_", ""));
    const res = await db.execute({
      sql: "SELECT id, name, price FROM foods WHERE id = ?",
      args: [foodId],
    });
    const food = res.rows[0];

    if (!food) {
      return ctx.reply("⚠️ Food item not found.");
    }

    state.currentFood = String(food.name);
    state.currentFoodPrice = Number(food.price);
    state.step = "waiting_for_quantity";

    await ctx.reply(
      `🍽 You selected *${food.name}* (${food.price} ETB).\n\n*How many would you like?*`,
      {
        parse_mode: "Markdown",
        reply_markup: quantityKeyboard.reply_markup,
      }
    );
  });

  bot.action("custom_food", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.step = "custom_food_name";
    await ctx.reply("✏️ Type the name of your custom food item:");
  });

  // Quick Quantity Buttons (1 - 5)
  bot.action(/^qty_([1-5])$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const data = getCallbackData(ctx);
    if (!data) return;

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state || !state.currentFood || state.currentFoodPrice === undefined) return;

    const quantity = Number(data.replace("qty_", ""));
    state.foods.push({
      name: state.currentFood,
      quantity,
      price: state.currentFoodPrice,
    });

    const addedName = state.currentFood;
    state.currentFood = undefined;
    state.currentFoodPrice = undefined;
    state.step = "select_food";

    const foodKb = await getFoodKeyboard(state.restaurantId);

    await ctx.reply(
      `✅ Added *${quantity}x ${addedName}* to your order!\n\nSelect another food or press ✅ Done Selecting Foods.`,
      {
        parse_mode: "Markdown",
        reply_markup: foodKb.reply_markup,
      }
    );
  });

  bot.action("qty_more", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.step = "waiting_for_custom_quantity";
    await ctx.reply(`🔢 Enter custom quantity for *${state.currentFood}* (1-50):`, {
      parse_mode: "Markdown",
    });
  });

  // Done Selecting Foods -> Ask Delivery Contract Question
  bot.action("done_food", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state || state.foods.length === 0) {
      return ctx.reply("⚠️ Please select at least one food item before continuing.");
    }

    state.step = "ask_delivery_contract";

    await ctx.reply(
      "🚚 *Do you have a delivery contract?*",
      {
        parse_mode: "Markdown",
        reply_markup: deliveryContractKeyboard.reply_markup,
      }
    );
  });

  // Delivery Contract Choice Handlers
  bot.action("del_contract_yes", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    const contract = await checkDeliveryContract(userId);

    if (contract) {
      state.hasDeliveryContract = true;
      await ctx.reply(
        `🎫 *Delivery Contract Active!*\n\n📊 Current Balance: *${contract.remaining_deliveries} deliveries remaining*`,
        { parse_mode: "Markdown" }
      );
      return showOrderSummary(ctx, state);
    } else {
      state.hasDeliveryContract = false;
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("📩 Request Delivery Contract", "req_del_contract")],
        [Markup.button.callback("Continue without Contract", "continue_no_del_contract")],
      ]);

      await ctx.editMessageText(
        "⚠️ *You do not have an active delivery contract (0 remaining).*",
        {
          parse_mode: "Markdown",
          reply_markup: kb.reply_markup,
        }
      );
    }
  });

  bot.action("del_contract_no", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.hasDeliveryContract = false;
    return showOrderSummary(ctx, state);
  });

  bot.action("continue_no_del_contract", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    state.hasDeliveryContract = false;
    return showOrderSummary(ctx, state);
  });

  bot.action("req_del_contract", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state) return;

    try {
      const usernameTag = ctx.from?.username ? `@${ctx.from.username}` : "N/A";

      const insertRes = await db.execute({
        sql: `INSERT INTO contract_requests (telegram_id, user_name, username, phone, campus, request_type, status)
              VALUES (?, ?, ?, ?, ?, 'delivery_contract', 'pending')
              RETURNING id`,
        args: [
          userId,
          state.name || ctx.from?.first_name || "User",
          usernameTag,
          state.phone || "",
          state.campus || "",
        ],
      });

      const reqId = Number(insertRes.rows[0]?.id);

      const adminMsgText =
        `📥 *New Delivery Contract Request*\n\n` +
        `👤 *Name:* ${escapeMarkdown(state.name || "User")}\n` +
        `📞 *Phone:* ${escapeMarkdown(formatPhoneLink(state.phone))}\n` +
        `🏫 *Campus:* ${escapeMarkdown(formatCampusName(state.campus))}\n` +
        `🆔 *Telegram ID:* \`${userId}\`\n` +
        `👤 *Username:* ${escapeMarkdown(usernameTag)}`;

      const adminKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Confirm / Approve", `admin_req_approve_${reqId}`),
          Markup.button.callback("❌ Cancel / Reject", `admin_req_reject_${reqId}`),
        ],
      ]);

      const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(id => Number(id.trim())).filter(id => !isNaN(id));
      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, adminMsgText, {
            parse_mode: "Markdown",
            reply_markup: adminKeyboard.reply_markup,
          });
        } catch (e) {}
      }

      state.hasDeliveryContract = false;
      return showOrderSummary(ctx, state);
    } catch (err) {
      console.error("Request delivery contract error:", err);
      return showOrderSummary(ctx, state);
    }
  });

  // Display Order Summary
  async function showOrderSummary(ctx: Context, state: UserState) {
    state.step = "confirm_order";
    const userId = ctx.from!.id;

    const totalItems = state.foods.reduce((acc, f) => acc + f.quantity, 0);
    const foodSubtotal = state.hasRestaurantContract
      ? 0
      : state.foods.reduce((acc, f) => acc + f.price * f.quantity, 0);

    let deliveryFee = 0;
    let deliveryPricePerFood = 0;
    let deliveryFormatted = "";

    if (state.hasDeliveryContract) {
      const delContract = await checkDeliveryContract(userId);
      const rem = delContract ? Number(delContract.remaining_deliveries) : 0;
      deliveryFee = 0;
      deliveryPricePerFood = 0;
      deliveryFormatted = `🎫 Contract Delivery (0 ETB)\n📊 Balance: *${rem} deliveries remaining*`;
    } else {
      const priceInfo = await getApplicableDeliveryPrice(state.campus, state.restaurantId);
      if (!priceInfo) {
        const msg = "⚠️ Normal delivery pricing has not been configured for your selected campus/restaurant. Please contact Admin or support.";
        if (ctx.callbackQuery) {
          return ctx.editMessageText(msg, { parse_mode: "Markdown" });
        }
        return ctx.reply(msg, { parse_mode: "Markdown" });
      }
      deliveryPricePerFood = priceInfo.pricePerFood;
      deliveryFee = totalItems * deliveryPricePerFood;
      deliveryFormatted = `${totalItems} food × ${deliveryPricePerFood} ETB\n= ${deliveryFee} ETB`;
    }

    const grandTotal = foodSubtotal + deliveryFee;

    const foodItemsFormatted = state.foods
      .map((f) => `• *${f.name}* × ${f.quantity} — ${f.price * f.quantity} ETB`)
      .join("\n");

    const summaryText =
      `📋 *Order Summary*\n\n` +
      `👤 *Name:* ${state.name || "N/A"}\n` +
      `📞 *Phone:* ${formatPhoneLink(state.phone)}\n` +
      `🏫 *Campus:* ${formatCampusName(state.campus)}\n` +
      `🏢 *Restaurant:* ${state.restaurant || "N/A"}\n\n` +
      `🍱 *Food Items:*\n${foodItemsFormatted}\n\n` +
      `🍽️ *Food Total:* ${foodSubtotal} ETB\n\n` +
      `🚚 *Delivery:*\n${deliveryFormatted}\n\n` +
      `💵 *Grand Total:* ${grandTotal} ETB\n\n` +
      `Please review and confirm your order:`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(summaryText, {
        parse_mode: "Markdown",
        reply_markup: confirmKeyboard.reply_markup,
      });
    } else {
      await ctx.reply(summaryText, {
        parse_mode: "Markdown",
        reply_markup: confirmKeyboard.reply_markup,
      });
    }
  }

  // Confirm Order Action (with double-click protection)
  bot.action("confirm_order", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state || state.foods.length === 0) {
      return ctx.reply("⚠️ Session expired or order empty. Please start again with /start.");
    }

    if (state.isSubmittingOrder) {
      return; // Double-submit guard!
    }
    state.isSubmittingOrder = true;

    try {
      const totalItems = state.foods.reduce((acc, f) => acc + f.quantity, 0);
      const foodSubtotal = state.hasRestaurantContract
        ? 0
        : state.foods.reduce((acc, f) => acc + f.price * f.quantity, 0);

      let deliveryFee = 0;
      let deliveryPricePerFood = 0;

      if (state.hasDeliveryContract) {
        deliveryFee = 0;
        deliveryPricePerFood = 0;
      } else {
        const priceInfo = await getApplicableDeliveryPrice(state.campus, state.restaurantId);
        if (!priceInfo) {
          state.isSubmittingOrder = false;
          return ctx.reply("⚠️ Delivery pricing is not configured for this campus/restaurant. Order cannot be submitted.");
        }
        deliveryPricePerFood = priceInfo.pricePerFood;
        deliveryFee = totalItems * deliveryPricePerFood;
      }

      const grandTotal = foodSubtotal + deliveryFee;

      const foodsSummary = state.foods
        .map((f) => `${f.name} x${f.quantity}`)
        .join(", ");

      // 1. Insert order record
      const orderRes = await db.execute({
        sql: `INSERT INTO orders (telegram_id, user_name, phone, campus, restaurant, meal_type, restaurant_id, foods_summary, has_restaurant_contract, has_delivery_contract, food_total, delivery_fee, total_price, delivery_price_per_food, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
              RETURNING id;`,
        args: [
          userId,
          state.name || "Customer",
          state.phone || "",
          state.campus || "",
          state.restaurant || "",
          state.mealType || "",
          state.restaurantId ? Number(state.restaurantId) : null,
          foodsSummary,
          state.hasRestaurantContract ? 1 : 0,
          state.hasDeliveryContract ? 1 : 0,
          foodSubtotal,
          deliveryFee,
          grandTotal,
          deliveryPricePerFood,
        ],
      });

      const orderId = Number(orderRes.rows[0]?.id);

      // 2. Insert order items with price_at_order preservation (Requirement 15)
      for (const item of state.foods) {
        await db.execute({
          sql: `INSERT INTO order_items (order_id, food_name, quantity, price_at_order)
                VALUES (?, ?, ?, ?)`,
          args: [orderId, item.name, item.quantity, item.price],
        });
      }

      // 3. Decrement contract counters if active safely (Requirement 20)
      if (state.hasRestaurantContract) {
        await db.execute({
          sql: `UPDATE restaurant_contracts
                SET remaining_meals = remaining_meals - 1
                WHERE id = (
                  SELECT id FROM restaurant_contracts
                  WHERE telegram_id = ? AND is_active = 1 AND remaining_meals > 0
                  LIMIT 1
                )`,
          args: [userId],
        });
      }

      let deliveryContractNote = "";
      if (state.hasDeliveryContract) {
        await db.execute({
          sql: `UPDATE delivery_contracts
                SET remaining_deliveries = remaining_deliveries - 1
                WHERE id = (
                  SELECT id FROM delivery_contracts
                  WHERE telegram_id = ? AND is_active = 1 AND remaining_deliveries > 0
                  LIMIT 1
                )`,
          args: [userId],
        });

        const updatedContract = await checkDeliveryContract(userId);
        const remAfter = updatedContract ? Number(updatedContract.remaining_deliveries) : 0;
        deliveryContractNote = `\n\n🚚 *Delivery Contract Used:* 1 delivery consumed (*${remAfter} deliveries remaining*).`;
      }

      // 4. Notify active campus riders with normalized matching & fallback (Requirement 6 & 7)
      const allActiveRiders = await db.execute({
        sql: "SELECT id, telegram_id, name, phone, campus FROM riders WHERE (active IS NULL OR active = 1 OR active = '1') AND telegram_id IS NOT NULL AND telegram_id != 0 AND telegram_id != '0'",
        args: [],
      });

      console.log(`🔍 Order #${orderId} - Found ${allActiveRiders.rows.length} total activated rider(s) in DB.`);

      const normOrderCampus = (state.campus || "").replace(/^campus_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

      let targetRiders = allActiveRiders.rows.filter((r) => {
        const rNorm = String(r.campus || "").replace(/^campus_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return rNorm === normOrderCampus || rNorm.includes(normOrderCampus) || normOrderCampus.includes(rNorm);
      });

      if (targetRiders.length === 0) {
        console.log(`ℹ️ No rider matched campus '${state.campus}' specifically. Broadcasting to all ${allActiveRiders.rows.length} active riders.`);
        targetRiders = allActiveRiders.rows;
      } else {
        console.log(`🎯 Matched ${targetRiders.length} rider(s) for campus '${state.campus}'.`);
      }

      const telLink = formatPhoneLink(state.phone);
      const itemsListFormatted = state.foods
        .map((f) => `• ${escapeHTML(f.name)} × ${f.quantity}`)
        .join("\n");

      const riderMsgHTML =
        `🛵 <b>New Order #${orderId}</b>\n\n` +
        `👤 <b>Customer:</b> ${escapeHTML(state.name || "User")}\n` +
        `📞 <b>Phone:</b> ${escapeHTML(telLink)}\n` +
        `🏫 <b>Campus:</b> ${escapeHTML(formatCampusName(state.campus))}\n` +
        `🍴 <b>Restaurant:</b> ${escapeHTML(state.restaurant || "N/A")}\n\n` +
        `🍱 <b>Order Summary:</b>\n${itemsListFormatted}\n\n` +
        `🍽️ <b>Food Contract:</b> ${state.hasRestaurantContract ? "Yes" : "No"}\n` +
        `🚚 <b>Delivery Contract:</b> ${state.hasDeliveryContract ? "Yes" : "No"}\n\n` +
        `💰 <b>Total Price:</b> ${grandTotal} ETB`;

      const riderKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Accept Order", `accept_order_${orderId}`),
          Markup.button.callback("❌ Reject", `reject_order_${orderId}`),
        ],
      ]);

      for (const r of targetRiders) {
        const tid = Number(r.telegram_id);
        if (tid && !isNaN(tid)) {
          try {
            console.log(`📡 Sending order #${orderId} notification to rider ${r.name} (Telegram ID: ${tid})...`);
            await bot.telegram.sendMessage(tid, riderMsgHTML, {
              parse_mode: "HTML",
              reply_markup: riderKeyboard.reply_markup,
            });
            console.log(`✅ Successfully sent order #${orderId} notification to rider ${r.name} (${tid})!`);
          } catch (e) {
            console.error(`⚠️ Failed HTML notification to rider ${r.name} (${tid}), attempting plain text fallback:`, e);
            try {
              const plainMsg = riderMsgHTML.replace(/<[^>]+>/g, "");
              await bot.telegram.sendMessage(tid, plainMsg, {
                reply_markup: riderKeyboard.reply_markup,
              });
              console.log(`✅ Successfully sent fallback order #${orderId} notification to rider ${r.name} (${tid})!`);
            } catch (err2) {
              console.error(`❌ Failed plain text notification to rider ${r.name} (${tid}):`, err2);
            }
          }
        }
      }

      // 5. Respond to user
      await ctx.editMessageText(
        `✅ *Order #${orderId} Placed Successfully!*\n\n` +
          `Your order has been sent to our campus riders. We will notify you as soon as a rider accepts your order!${deliveryContractNote}`,
        { parse_mode: "Markdown" }
      );

      resetUserState(userId);
    } catch (err) {
      console.error("Confirm order error:", err);
      state.isSubmittingOrder = false;
      await ctx.reply("❌ Order submission failed. Please try again.");
    }
  });

  bot.action("cancel_order", async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from!.id;
    resetUserState(userId);

    await ctx.editMessageText("❌ *Order cancelled.*", {
      parse_mode: "Markdown",
    });
  });
}
