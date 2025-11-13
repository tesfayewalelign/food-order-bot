import { Markup } from "telegraf";

export const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback("➕ Add Rider", "admin_add_rider")],
  [Markup.button.callback("✏️ Update Rider", "admin_update_rider")],
  [Markup.button.callback("❌ Remove Rider", "admin_remove_rider")],
  [Markup.button.callback("🏪 Manage Cafes / Foods", "admin_manage_cafe")],
]);
