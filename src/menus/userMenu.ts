import { Markup } from "telegraf";

// Campus selection
export const campusMenu = Markup.inlineKeyboard([
  [Markup.button.callback("Main Boys Dorm", "campus_main_boys")],
  [Markup.button.callback("Main Female Dorm", "campus_main_female")],
  [Markup.button.callback("Techno Boys Dorm", "campus_techno_boys")],
  [Markup.button.callback("Techno Female Dorm", "campus_techno_female")],
]);

// Restaurants (example)
export const restaurantMenu = Markup.inlineKeyboard([
  [Markup.button.callback("Askuala", "restaurant_askuala")],
  [Markup.button.callback("Fike", "restaurant_fike")],
  [Markup.button.callback("Mesi", "restaurant_mesi")],
  [Markup.button.callback("Pepsi", "restaurant_pepsi")],
  [Markup.button.callback("Shewit", "restaurant_shewit")],
]);
