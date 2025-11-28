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

        if (!state.restaurantId) return ctx.reply("⚠️ No restaurant selected.");

        const keyboard = await getFoodKeyboard(state.restaurantId);
        return ctx.reply("✅ Added! Select another food or press ✅ Done.", {
          reply_markup: keyboard?.reply_markup,
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

    state.campus = data.replace("campus_", "").replace(/_/g, " ");

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
    const keyboard = await getRestaurantKeyboard();
    await ctx.editMessageText("🍴 Choose your restaurant:", {
      reply_markup: keyboard.reply_markup,
    });
    return ctx.answerCbQuery();
  });

  // === Restaurant Selection Handler ===
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
    state.foods = [];
    state.step = "select_meal_type";

    await ctx.editMessageText(
      `🍴 *${restaurant.name}*\nPlease choose meal type:`,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🥗 Lunch", "meal_lunch")],
          [Markup.button.callback("🌙 Dinner", "meal_dinner")],
          [Markup.button.callback("🔙 Back", "back_to_restaurants")],
        ]).reply_markup,
      }
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

    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const mealType = data.replace("meal_", "");
    state.mealType = mealType;
    state.step = "select_food";

    const keyboard = await getFoodKeyboard(state.restaurantId, mealType);

    if (!keyboard)
      return ctx.editMessageText(
        `⚠️ No foods available for ${state.restaurant} (${mealType})`
      );

    await ctx.editMessageText(
      `🍔 *Select foods from ${state.restaurant} (${mealType})*\nPlease choose your items below. Press ✅ Done when finished.`,
      { parse_mode: "Markdown", reply_markup: keyboard.reply_markup }
    );

    return ctx.answerCbQuery();
  });

  bot.action("custom_restaurant", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery("⚠️ Session expired. /start", {
        show_alert: true,
      });

    state.step = "custom_restaurant_name";
    state.restaurantId = undefined;

    await ctx.editMessageText(
      "✏️ Please type the name of your restaurant or café:",
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back", "back_to_restaurants")],
        ]).reply_markup,
      }
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

      const keyboard = await getFoodKeyboard(undefined, state.restaurant);
      await ctx.reply(
        `🍔 Select foods from ${state.restaurant}:`,
        keyboard?.reply_markup
          ? { reply_markup: keyboard.reply_markup }
          : undefined
      );
    }
  });

  // === Back to Restaurants Handler ===
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

    const keyboard = Markup.inlineKeyboard(keyboardRows);

    await ctx.editMessageText("🚚 Choose delivery type:", {
      reply_markup: keyboard.reply_markup,
    });

    return ctx.answerCbQuery();
  });

  bot.action("request_contract", async (ctx) => {
    const userId = ctx.from!.id;

    try {
      // check for active contract (look by user_id OR telegram_id)
      const { data: activeContract } = await supabase
        .from("contracts")
        .select("*")
        .or(`user_id.eq.${userId},telegram_id.eq.${userId}`)
        .eq("is_active", true)
        .maybeSingle();

      if (activeContract) {
        return ctx.answerCbQuery(
          "✔️ You already have an active contract! You can order with it.",
          { show_alert: true }
        );
      }

      // check for a pending request
      const { data: pendingRequest } = await supabase
        .from("contract_requests")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending")
        .maybeSingle();

      if (pendingRequest) {
        return ctx.answerCbQuery(
          "⏳ Your contract request is still pending. Please wait for admin approval.",
          { show_alert: true }
        );
      }

      // get profile for nicer details
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, phone")
        .eq("telegram_id", userId)
        .maybeSingle();

      const fullName =
        profile?.name ||
        `${ctx.from!.first_name ?? ""} ${ctx.from!.last_name ?? ""}`.trim();
      const phone = profile?.phone || "Not Provided";

      const { error: insertError } = await supabase
        .from("contract_requests")
        .insert({
          user_id: userId,
          username: ctx.from!.username || null,
          full_name: fullName,
          phone,
          status: "pending",
        });

      if (insertError) {
        console.error("Insert contract request error:", insertError);
        return ctx.answerCbQuery(
          "❌ Failed to send request. Try again later.",
          { show_alert: true }
        );
      }

      // notify admins with hint to use admin panel (they approve via admin UI)
      for (const adminId of ADMIN_IDS) {
        await ctx.telegram.sendMessage(
          adminId,
          `📥 *New Contract Request*\n\n` +
            `👤 *Name:* ${fullName}\n` +
            `📱 *Phone:* ${phone}\n` +
            `🔗 *Username:* @${ctx.from!.username || "N/A"}\n` +
            `🆔 *Telegram ID:* ${userId}\n\n` +
            `Please review in Admin → Requests.`,
          { parse_mode: "Markdown" }
        );
      }

      await ctx.editMessageText(
        "📨 *Your contract request has been sent!*\n\n" +
          "Please wait for an admin to approve it. Once approved you will receive a notification and then you can use the *Use Contract* option.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💵 Pay on Delivery", callback_data: "delivery_new" }],
            ],
          },
        }
      );

      return ctx.answerCbQuery();
    } catch (err) {
      console.error("Request contract error:", err);
      return ctx.answerCbQuery("❌ Something went wrong. Try again later.", {
        show_alert: true,
      });
    }
  });

  bot.action(/^delivery_(.+)/, async (ctx) => {
    const data = getCallbackData(ctx);
    if (!data) return ctx.answerCbQuery();

    const userId = ctx.from!.id;
    const state = userState.get(userId);
    if (!state)
      return ctx.answerCbQuery(
        "⚠️ Session expired. Please restart with /start.",
        {
          show_alert: true,
        }
      );

    const deliveryType = data.replace("delivery_", "") as "new" | "contract";
    state.deliveryType = deliveryType;
    state.step = "confirm_order";

    const deliveryFee = deliveryType === "new" ? 10 : 0;
    const subtotal = state.foods.reduce(
      (acc, f) => acc + f.price * f.quantity,
      0
    );
    const totalPrice = subtotal + deliveryFee;

    const foodsList = state.foods
      .map((f) => `\`${f.name} x${f.quantity} = ${f.price * f.quantity} ETB\``)
      .join("\n");

    let contractInfo = "";
    if (deliveryType === "contract") {
      const contract = await getUserContract(userId);
      contractInfo = contract
        ? `📦 Remaining Contract Orders: ${contract.remaining_orders}`
        : "⚠️ Contract status unknown.";
    }
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

    await ctx.editMessageText(
      `🧾 *Order Summary*\n\n👤 ${state.name || "N/A"}\n📞 ${
        state.phone || "N/A"
      }\n🏫 ${state.campus || "N/A"}\n🍽 ${
        state.restaurant || "N/A"
      }\n\n🍔 *Items:*\n${foodsList}\n\n💰 Subtotal: ${subtotal} ETB\n🚚 Delivery Fee: ${deliveryFee} ETB\n💵 Total: ${totalPrice} ETB\n\n${contractInfo}`,
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

  bot.action("confirm_order", async (ctx) => {
    const userId = ctx.from!.id;
    const state = userState.get(userId);

    if (!state) {
      return ctx.answerCbQuery(
        "⚠️ Session expired. Please restart with /start.",
        { show_alert: true }
      );
    }

    const deliveryFee = state.deliveryType === "new" ? 10 : 0;
    const subtotal = state.foods.reduce(
      (acc, f) => acc + f.price * f.quantity,
      0
    );
    const totalPrice = subtotal + deliveryFee;

    const foodsList = state.foods
      .map((f) => `${f.name} x${f.quantity}`)
      .join(", ");

    try {
      if (state.deliveryType === "contract") {
        const contract = await getUserContract(userId);

        if (!contract) {
          return ctx.answerCbQuery(
            "⚠️ You don’t have an active contract. Please request a contract or pay per order.",
            { show_alert: true }
          );
        }

        if (!contract.is_active || contract.remaining_orders <= 0) {
          return ctx.answerCbQuery(
            "⚠️ Your contract orders are exhausted. Contact admin to reactivate.",
            { show_alert: true }
          );
        }

        const newRemaining = contract.remaining_orders - 1;
        await supabase
          .from("contracts")
          .update({ remaining_orders: newRemaining })
          .eq("id", contract.id);

        if (newRemaining === 0) {
          for (const adminId of ADMIN_IDS) {
            await ctx.telegram.sendMessage(
              adminId,
              `⚠️ Contract for @${state.username || ""} (${
                state.name
              }) has reached 0 remaining orders. Reactivation needed.`
            );
          }
        }
      }

      if (!state.campus) {
        return ctx.reply("⚠️ Campus not selected yet.");
      }
      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert([
          {
            user_name: state.name,
            phone: state.phone,
            campus: state.campus,
            restaurant: state.restaurant,
            foods: foodsList,
            total: totalPrice,
            delivery_type: state.deliveryType,
            telegram_id: userId,
            status: "pending",
          },
        ])
        .select("id")
        .single();

      if (insertError || !insertedOrder) {
        console.error("Insert error:", insertError);
        return ctx.reply("❌ Order could not be saved.");
      }

      const orderId = insertedOrder.id;

      console.log("Order ID:", orderId);

      const campusNormalized = state.campus
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      const { data: riders } = await supabase
        .from("riders")
        .select("telegram_id, campus")
        .eq("active", true);

      const campusRiders = riders?.filter(
        (r) =>
          r.campus.toLowerCase().replace(/\s+/g, " ").trim() ===
          campusNormalized
      );

      if (campusRiders?.length) {
        for (const r of campusRiders) {
          if (r.telegram_id) {
            await ctx.telegram.sendMessage(
              r.telegram_id,
              `🆕 *New Order*\nID: ${userId}\n🍔 ${state.restaurant}\n👤 ${state.name}\n🏫 ${state.campus}\n📞[${state.phone}](tel:${state.phone})\n💰 Total: ${totalPrice} ETB\n📝 Foods: ${foodsList}`,

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
      }
      resetUserState(userId);
      await ctx.editMessageText(
        "✅ Order placed successfully! The restaurant is preparing your food. You will be notified when a rider picks it up."
      );
      return ctx.answerCbQuery();
    } catch (err) {
      console.error("Confirm order error:", err);
      return ctx.answerCbQuery(
        "❌ Order failed due to a database error. Please try again.",
        { show_alert: true }
      );
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
