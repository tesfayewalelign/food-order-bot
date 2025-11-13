import { Markup } from "telegraf";

export const createFoodButtons = (foods: { id: string; name: string }[]) => {
  const buttons = foods.map((f) =>
    Markup.button.callback(f.name, `food_${f.id}`)
  );
  return Markup.inlineKeyboard(buttons, { columns: 2 });
};
