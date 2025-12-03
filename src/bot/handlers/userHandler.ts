import { Telegraf, Context, Markup } from "telegraf";
import { supabase } from "../../config/supabase.js";
import { userState, resetUserState, UserState } from "../../helpers/state.js";
import {
  getMainMenuKeyboard,
  campusKeyboard,
  getRestaurantKeyboard,
  getFoodKeyboard,
  getUserContract,
} from "../../helpers/keyboards.js";
import { isOrderTime, nextOrderWindow } from "../../helpers/time.js";

import { v4 as uuidv4 } from "uuid";

function isTextMessage(msg: any): msg is { text: string } {
  return msg && typeof msg.text === "string";
}
function isContactMessage(
  msg: any
): msg is { contact: { phone_number: string } } {
  return msg && msg.contact && typeof msg.contact.phone_number === "string";
}

const getCallbackData = (ctx: Context) =>
  (ctx.callbackQuery as { data?: string } | undefined)?.data ?? null;

const initUserState = async (userId: number, profile?: any) => {
  let state = userState.get(userId);
  if (!state) {
    state = {
      step: profile ? "idle" : "profile_ask_name",
      foods: [],
      cartFoods: [],
      currentFood: undefined,
      currentFoodPrice: undefined,
      deliveryType: undefined,
      restaurant: profile?.restaurant || "",
      restaurantId: profile?.restaurantId || undefined,
      campus: profile?.campus || "",
      name: profile?.name || "",
      phone: profile?.phone || "",
    };
    userState.set(userId, state);
  }
  return state as UserState;
};

export function handleUserFlow(
  bot: Telegraf<Context>,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[]
) {
  bot.on("message", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      if (ADMIN_IDS.includes(userId) || DRIVER_IDS.includes(userId)) return;

      const msg = ctx.message;
      if (!msg || !("text" in msg || "contact" in msg)) return;

      if ("text" in msg && msg.text.startsWith("/")) return;

      let state = userState.get(userId);
      if (!state) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("telegram_id", userId)
          .maybeSingle();

        state = await initUserState(userId, profile);
      }

      if (state.step === "profile_ask_name" && isTextMessage(msg)) {
        state.name = msg.text;
        state.step = "profile_ask_phone";
        userState.set(userId, state);

        return ctx.reply(
          "📞 Please share your phone number:",
          Markup.keyboard([
            Markup.button.contactRequest("📱 Share Phone"),
          ]).resize()
        );
      }

      if (state.step === "profile_ask_phone" && isContactMessage(msg)) {
        state.phone = msg.contact.phone_number;
        state.step = "profile_ask_campus";
        userState.set(userId, state);

        return ctx.reply("🏫 Select your campus:", campusKeyboard);
      }

      if (state.step === "waiting_for_quantity" && isTextMessage(msg)) {
        const quantity = Number(msg.text);
        if (!quantity || quantity <= 0 || !Number.isInteger(quantity))
          return ctx.reply("⚠️ Enter a valid whole number.");

        state.foods.push({
          name: state.currentFood!,
          quantity,
          price: state.currentFoodPrice!,
        });

        state.currentFood = undefined;
        state.currentFoodPrice = undefined;

        if (state.restaurantId) {
          const keyboard = await getFoodKeyboard(
            state.restaurantId,
            state.mealType
          );
          return ctx.reply("✅ Added! Select another food or press ✅ Done.", {
            reply_markup: keyboard?.reply_markup,
          });
        } else {
          state.step = "custom_food_name";
          return ctx.reply(
            "✅ Added! Type the name of the next custom food or press ✅ Done.",
            Markup.inlineKeyboard([
              [Markup.button.callback("✅ Done", "done_food")],
            ])
          );
        }
      }
      if (state.step === "custom_restaurant_name" && isTextMessage(msg)) {
        state.restaurant = msg.text.trim();
        state.restaurantId = undefined;
        state.step = "select_meal_type";

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("🥗 Lunch", "meal_lunch")],
          [Markup.button.callback("🌙 Dinner", "meal_dinner")],
          [Markup.button.callback("🔙 Back", "back_to_restaurants")],
        ]);

        return ctx.reply(`🍴 *${state.restaurant}*\nPlease choose meal type:`, {
          parse_mode: "Markdown",
          reply_markup: keyboard.reply_markup,
        });
      }

      if (state.step === "custom_food_name" && isTextMessage(msg)) {
        state.currentFood = msg.text.trim();
        state.step = "ask_custom_price";

        return ctx.reply(
          `💲 Enter the price for *${state.currentFood}* (send 0 if unknown):`,
          { parse_mode: "Markdown" }
        );
      }

      if (state.step === "ask_custom_price" && isTextMessage(msg)) {
        const price = Number(msg.text);
        if (isNaN(price) || price < 0)
          return ctx.reply("⚠️ Invalid price. Enter a number or 0.");

        state.currentFoodPrice = price;
        state.step = "waiting_for_quantity";

        return ctx.reply(`🔢 Enter quantity for *${state.currentFood}*:`, {
          parse_mode: "Markdown",
        });
      }

      if (isTextMessage(msg)) {
        switch (msg.text) {
          case "🍔 Order Food":
            state.step = "profile_ask_campus";
            return ctx.reply("🍔 Choose your campus:", campusKeyboard);

          case "📦 My Orders":
            const { data: orders } = await supabase
              .from("orders")
              .select("*")
              .eq("telegram_id", userId)
              .order("id", { ascending: false });

            if (!orders || orders.length === 0)
              return ctx.reply("📂 You have no orders yet.");

            const ordersList = orders
              .map(
                (o) =>
                  `• 🆔 Order #${o.id}\n  🍽 ${o.restaurant}\n  💰 Total: ${o.total} ETB\n  📦 Status: ${o.status}`
              )
              .join("\n\n");

            return ctx.reply(`📂 Your Orders:\n\n${ordersList}`);

          case "ℹ️ Help":
            return ctx.reply(
              "📝 Help Menu:\n" +
                "• 🍔 Order Food → Start a new order\n" +
                "• 📦 My Orders → View past orders\n" +
                "• 🏠 Main Menu → Return to main menu\n" +
                "• /start → Restart the bot anytime"
            );

          case "🏠 Main Menu":
            resetUserState(userId);
            state.step = "idle";
            return ctx.reply(
              "🏠 Main Menu:",
              getMainMenuKeyboard(false, false)
            );

          default:
            return ctx.reply(
              "🤔 Command not recognized. Use the buttons below or /start to restart.",
              getMainMenuKeyboard(false, false)
            );
        }
      }
    } catch (err) {
      console.error("User message handler error:", err);

      return ctx.reply("⚠️ Something went wrong. Please try again.");
    }
  });
  bot.action(/^campus_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.campus = data;

    if (state.step === "profile_ask_campus") {
      await supabase.from("profiles").upsert(
        [
          {
            telegram_id: userId,
            name: state.name,
            phone: state.phone,
            campus: state.campus,
          },
        ],
        { onConflict: "telegram_id" }
      );
    }

    state.step = "ask_restaurant";

    const restaurantKeyboard = await getRestaurantKeyboard();

    const keyboardWithBack = Markup.inlineKeyboard([
      ...restaurantKeyboard.reply_markup.inline_keyboard,
      [Markup.button.callback("🔙 Back to Campus", "back_to_campus")],
    ]);

    await ctx.editMessageText("🍴 Choose your restaurant:", {
      reply_markup: keyboardWithBack.reply_markup,
    });

    return ctx.answerCbQuery();
  });
  bot.action("back_to_campus", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.restaurant = "";
    state.restaurantId = undefined;
    state.step = "profile_ask_campus";

    await ctx.editMessageText("🏫 Select your campus:", campusKeyboard);
    return ctx.answerCbQuery();
  });

  bot.action(/^restaurant_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    const restaurantId = data.replace("restaurant_", "");
    state.restaurantId = restaurantId;

    const { data: restaurant, error } = await supabase
      .from("restaurants")
      .select("id, name")
      .eq("id", restaurantId)
      .maybeSingle();

    if (error || !restaurant) {
      console.error("Restaurant lookup failed:", error);
      return ctx.answerCbQuery("⚠️ Restaurant not found", { show_alert: true });
    }

    state.restaurant = restaurant.name;
    state.step = "select_meal_type";
    state.foods = [];

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🥗 Lunch", `meal_lunch`)],
      [Markup.button.callback("🌙 Dinner", `meal_dinner`)],
      [Markup.button.callback("🔙 Back", `back_to_restaurants`)],
    ]);

    await ctx.editMessageText(
      `🍴 *${restaurant.name}*\nPlease choose meal type:`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  bot.action(/^meal_(.+)/, async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    const mealType = getCallbackData(ctx)?.replace("meal_", "");
    if (!mealType) return ctx.answerCbQuery();

    state.mealType = mealType;
    state.step = "select_food";

    const keyboard =
      (await getFoodKeyboard(state.restaurantId, mealType)) ||
      Markup.inlineKeyboard([]);

    keyboard.reply_markup.inline_keyboard.push([
      Markup.button.callback("➕ Add Custom Food", "custom_food"),
      Markup.button.callback("✅ Done", "done_food"),
      Markup.button.callback("🔙 Back", "back_to_meal"),
    ]);

    await ctx.editMessageText(
      `🍔 *Select foods from ${state.restaurant} (${mealType})*\nPress ✅ Done when finished.`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  bot.action("back_to_restaurants", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.step = "ask_restaurant";
    const keyboard = await getRestaurantKeyboard();

    await ctx.editMessageText("🍴 Choose your restaurant:", {
      reply_markup: keyboard.reply_markup,
    });

    return ctx.answerCbQuery();
  });

  bot.action("custom_restaurant", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired.", { show_alert: true });

    state.step = "custom_restaurant_name";
    state.restaurant = undefined; // Reset

    await ctx.reply("✏️ Type the name of your restaurant or café:", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back", "back_to_meal")],
      ]).reply_markup,
    });

    return ctx.answerCbQuery();
  });

  bot.action("custom_food", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired.", { show_alert: true });

    state.step = "custom_food_name";

    await ctx.reply("✏️ Type the name of your custom food:");
    return ctx.answerCbQuery();
  });

  bot.action("back_to_meal", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.step = "select_meal_type";
    state.foods = [];

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🥗 Lunch", `meal_lunch`)],
      [Markup.button.callback("🌙 Dinner", `meal_dinner`)],
      [Markup.button.callback("🔙 Back", "back_to_restaurants")],
    ]);

    await ctx.editMessageText(
      `🍴 *${state.restaurant}*\nPlease choose meal type:`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  bot.on("message", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    const msg = ctx.message;

    if (!state || !msg || !isTextMessage(msg)) return;

    if (state.step === "custom_restaurant_name") {
      state.restaurant = msg.text.trim();
      state.step = "select_food";

      const keyboard =
        (await getFoodKeyboard(undefined, state.restaurant)) ||
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "back_to_restaurants")],
        ]);

      await ctx.editMessageText(`🍔 Select foods from ${state.restaurant}:`, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }
  });

  bot.action(/^food_(.+)$/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });
    const foodId = data.replace("food_", "");
    const { data: food, error } = await supabase
      .from("foods")
      .select("*")
      .eq("id", foodId)
      .maybeSingle();

    if (error) return ctx.reply("❌ Database error fetching food.");
    if (!food) return ctx.answerCbQuery("⚠️ Food not found");

    state.currentFood = food.name;
    state.currentFoodPrice = food.price ?? 0;
    state.step = "waiting_for_quantity";

    await ctx.reply(`🍽 You selected *${food.name}*. Enter quantity:`, {
      parse_mode: "Markdown",
    });
    return ctx.answerCbQuery();
  });

  bot.action("done_food", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state || state.foods.length === 0) {
      return ctx.answerCbQuery("⚠️ Select at least one food.", {
        show_alert: true,
      });
    }

    state.step = "choose_delivery_type";

    const [{ data: pendingRequest }, { data: activeContract }] =
      await Promise.all([
        supabase
          .from("contract_requests")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "pending")
          .maybeSingle(),

        supabase
          .from("contracts")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle(),
      ]);

    const keyboardRows: any[] = [
      [Markup.button.callback("💵 Pay on Delivery", "delivery_new")],
    ];

    if (activeContract && activeContract.remaining_orders > 0) {
      keyboardRows.push([
        Markup.button.callback("📦 Use Contract", "delivery_contract"),
      ]);
    } else if (!pendingRequest) {
      keyboardRows.push([
        Markup.button.callback("📥 Request Contract", "request_contract"),
      ]);
    }
    keyboardRows.push([
      Markup.button.callback("🔙 Back to Foods", "back_to_food_selection"),
    ]);

    const keyboard = Markup.inlineKeyboard(keyboardRows);

    await ctx.editMessageText("🚚 Choose delivery type:", {
      reply_markup: keyboard.reply_markup,
    });

    return ctx.answerCbQuery();
  });
  bot.action("request_contract", async (ctx) => {
    const userId = ctx.from!.id;

    try {
      // STEP 1: UPSERT USER INTO users TABLE
      const fullNameFromTelegram = `${ctx.from!.first_name ?? ""} ${
        ctx.from!.last_name ?? ""
      }`.trim();

      const { error: userError } = await supabase.from("users").upsert(
        {
          telegram_id: userId,
          name: fullNameFromTelegram || null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "telegram_id" } // MUST BE UNIQUE IN YOUR DB
      );

      if (userError) {
        console.error("Error upserting user:", userError);
        return ctx.answerCbQuery(
          "❌ Cannot process request. Try again later.",
          {
            show_alert: true,
          }
        );
      }

      // STEP 2: GET PROFILE DETAILS IF EXISTS
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, phone")
        .eq("telegram_id", userId)
        .maybeSingle();

      const finalFullName =
        profile?.name?.trim() || fullNameFromTelegram || "Unknown User";

      const phone = profile?.phone || "Not Provided";

      // STEP 3: INSERT CONTRACT REQUEST
      const { error: requestError } = await supabase
        .from("contract_requests")
        .insert([
          {
            user_id: userId,
            full_name: finalFullName,
            status: "pending",
            created_at: new Date().toISOString(),
          },
        ]);

      if (requestError) {
        console.error("Error inserting contract request:", requestError);
        return ctx.answerCbQuery(
          "❌ Failed to submit contract request. Please try again.",
          {
            show_alert: true,
          }
        );
      }

      // STEP 4: NOTIFY ADMINS
      for (const adminId of ADMIN_IDS) {
        await ctx.telegram.sendMessage(
          adminId,
          `📥 *New Contract Request*\n\n` +
            `👤 *Name:* ${finalFullName}\n` +
            `📱 *Phone:* ${phone}\n` +
            `🔗 *Username:* @${ctx.from!.username || "N/A"}\n` +
            `🆔 *Telegram ID:* ${userId}\n\n` +
            `Please check Admin → Requests.`,
          { parse_mode: "Markdown" }
        );
      }

      // STEP 5: EDIT USER MESSAGE
      if (ctx.callbackQuery) {
        await ctx.editMessageText(
          "📨 *Your contract request has been submitted!*\nPlease wait for an admin to approve it.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "💵 Pay on Delivery",
                    callback_data: "delivery_new",
                  },
                ],
              ],
            },
          }
        );
      }

      return ctx.answerCbQuery();
    } catch (err) {
      console.error("Request contract error:", err);
      return ctx.answerCbQuery("❌ Unexpected error. Try again later.", {
        show_alert: true,
      });
    }
  });

  bot.action("back_to_food_selection", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.step = "select_food";

    const keyboard =
      (await getFoodKeyboard(state.restaurantId, state.mealType)) ||
      Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back to Meal", "back_to_restaurants")],
      ]);

    await ctx.editMessageText(
      `🍔 *Select foods from ${state.restaurant} (${state.mealType})*\nPress ✅ Done when finished.`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  function escapeMarkdown(text: string) {
    if (!text) return "";
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
  }

  bot.action("confirm_order", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state) {
      bot.action(/^delivery_(.+)/, async (ctx) => {
        const data = getCallbackData(ctx);
        if (!data) return ctx.answerCbQuery();

        const userId = ctx.from!.id;
        const state = userState.get(userId);

        if (!state) {
          return ctx.answerCbQuery(
            "⚠️ Session expired. Please restart with /start.",
            {
              show_alert: true,
            }
          );
        }

        const deliveryType = data.replace("delivery_", "") as
          | "new"
          | "contract";
        state.deliveryType = deliveryType;
        state.step = "confirm_order";

        // Calculate prices
        const deliveryFee =
          deliveryType === "new"
            ? state.foods.reduce((acc, f) => acc + f.quantity * 10, 0)
            : 0;

        const subtotal = state.foods.reduce(
          (acc, f) => acc + f.price * f.quantity,
          0
        );

        const totalPrice = subtotal + deliveryFee;

        const foodsList = state.foods
          .map(
            (f) => `• ${f.name} x${f.quantity} = *${f.price * f.quantity} ETB*`
          )
          .join("\n");

        // Get contract details if needed
        let contractInfo = "";
        if (deliveryType === "contract") {
          const contract = await getUserContract(userId);
          contractInfo = contract
            ? `📦 Remaining Contract Orders: *${contract.remaining_orders}*`
            : "⚠️ Contract status unknown.";
        }

        // Auto-fill missing profile info
        if (!state.name || !state.phone) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("name, phone")
            .eq("telegram_id", userId)
            .maybeSingle();

          if (profile) {
            state.name = profile.name;
            state.phone = profile.phone;
          }
        }

        // FINAL SINGLE MESSAGE
        await ctx.editMessageText(
          `🧾 *Order Summary*\n\n` +
            `👤 *Name:* ${state.name || "N/A"}\n` +
            `📞 *Phone:* ${state.phone || "N/A"}\n` +
            `🏫 *Campus:* ${state.campus || "N/A"}\n` +
            `🍽 *Restaurant:* ${state.restaurant || "N/A"}\n` +
            `🍴 *Meal Type:* ${state.mealType || "N/A"}\n\n` +
            `🍔 *Items:*\n${foodsList}\n\n` +
            `💰 *Subtotal:* ${subtotal} ETB\n` +
            `🚚 *Delivery Fee:* ${deliveryFee} ETB\n` +
            `💵 *Total:* ${totalPrice} ETB\n\n` +
            `${contractInfo}`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback("✅ Confirm", "confirm_order"),
                Markup.button.callback("❌ Cancel", "cancel_order"),
              ],
            ]),
          }
        );

        return ctx.answerCbQuery();
      });

      return ctx.answerCbQuery(
        "⚠️ Session expired. Please restart with /start.",
        { show_alert: true }
      );
    }

    const deliveryFee =
      state.deliveryType === "new"
        ? state.foods.reduce((acc, f) => acc + f.quantity * 10, 0)
        : 0;

    const subtotal = state.foods.reduce(
      (acc, f) => acc + f.price * f.quantity,
      0
    );
    const totalPrice = subtotal + deliveryFee;

    const foodsList = state.foods
      .map((f) => `\`${f.name} x${f.quantity} = ${f.price * f.quantity} ETB\``)
      .join("\n");

    let updatedRemainingOrders: number | null = null;

    try {
      // ⚡ CONTRACT LOGIC
      if (state.deliveryType === "contract") {
        const contract = await getUserContract(userId);

        if (!contract) {
          return ctx.answerCbQuery(
            "⚠️ No active contract. Please request contract or choose delivery.",
            { show_alert: true }
          );
        }

        const totalFoodQty = state.foods.reduce(
          (acc, f) => acc + f.quantity,
          0
        );

        if (!contract.is_active || contract.remaining_orders < totalFoodQty) {
          return ctx.answerCbQuery("⚠️ Not enough contract orders remaining.", {
            show_alert: true,
          });
        }

        updatedRemainingOrders = contract.remaining_orders - totalFoodQty;

        await supabase
          .from("contracts")
          .update({ remaining_orders: updatedRemainingOrders })
          .eq("id", contract.id);
      }

      // ⚡ Save order in database
      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert([
          {
            user_name: state.name,
            phone: state.phone,
            campus: state.campus,
            restaurant: state.restaurant,
            foods: foodsList,
            subtotal,
            delivery_fee: deliveryFee,
            total: totalPrice,
            delivery_type: state.deliveryType,
            telegram_id: userId,
            status: "pending",
          },
        ])
        .select("id")
        .single();

      if (insertError || !insertedOrder) {
        return ctx.reply("❌ Order failed to save.");
      }

      const orderId = insertedOrder.id;

      // ⚡ BEFORE sending to rider → show final summary to user
      await ctx.editMessageText(
        `🎉 *Order Placed!*\n\n` +
          `👤 ${state.name}\n📞 ${state.phone}\n🏫 ${state.campus}\n🍽 ${state.restaurant}\n🍴 ${state.mealType}\n\n` +
          `🍔 *Items:*\n${foodsList}\n\n` +
          `💰 Subtotal: *${subtotal} ETB*\n` +
          `🚚 Delivery Fee: *${deliveryFee} ETB*\n` +
          `💵 Total: *${totalPrice} ETB*\n\n` +
          (updatedRemainingOrders !== null
            ? `📦 Remaining Contract Orders: *${updatedRemainingOrders}*`
            : ""),
        { parse_mode: "Markdown" }
      );

      // ⚡ Notify riders
      const { data: riders } = await supabase
        .from("riders")
        .select("telegram_id, campus")
        .eq("active", true);

      const campusRiders = riders?.filter((r) => r.campus === state.campus);

      if (campusRiders?.length) {
        for (const r of campusRiders) {
          await ctx.telegram.sendMessage(
            r.telegram_id,
            `🆕 *New Order*\n` +
              `🆔 Order ID: ${orderId}\n\n` +
              `👤 ${state.name}\n📞 ${state.phone}\n🏫 ${state.campus}\n🍽 ${state.restaurant}\n🍴 ${state.mealType}\n\n` +
              `🍔 *Items:*\n${foodsList}\n\n` +
              `💰 Food Price: *${subtotal} ETB*\n` +
              `🚚 Delivery Fee: *${deliveryFee} ETB*\n` +
              `💵 Total: *${totalPrice} ETB*\n\n` +
              (updatedRemainingOrders !== null
                ? `📦 Remaining Contract Orders: *${updatedRemainingOrders}*`
                : ""),
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Approve",
                      callback_data: `rider_order_approve_${orderId}`,
                    },
                  ],
                  [
                    {
                      text: "❌ Reject",
                      callback_data: `rider_order_reject_${orderId}`,
                    },
                  ],
                ],
              },
            }
          );
        }
      }

      resetUserState(userId);
      return ctx.answerCbQuery();
    } catch (err) {
      console.error("Confirm order error:", err);
      return ctx.answerCbQuery("❌ Error processing order.", {
        show_alert: true,
      });
    }
  });

  bot.action("cancel_order", async (ctx) => {
    const userId = ctx.from!.id;
    resetUserState(userId);
    await ctx.editMessageText(
      "❌ Order cancelled. Type /start to begin a new order."
    );
    return ctx.answerCbQuery();
  });
}
