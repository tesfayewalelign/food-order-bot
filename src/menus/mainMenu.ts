import { Markup } from "telegraf";

export const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback("🛒 Start Order", "menu_start_order")],
  [Markup.button.callback("⚙️ Admin Panel", "menu_admin")],
]);
