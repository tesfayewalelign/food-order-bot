import { getMainMenuKeyboard } from "../helpers/keyboards";
import { isAdmin } from "../helpers/utils.js";

export async function sendWelcome(
  ctx: any,
  ADMIN_IDS: number[],
  DRIVER_IDS: number[]
) {
  const tid = ctx.from?.id!;
  await ctx.reply(
    "👋 Welcome to the Campus Food Delivery Bot!\nUse the menu below to get started.",
    getMainMenuKeyboard(isAdmin(tid), DRIVER_IDS.includes(tid))
  );
}
