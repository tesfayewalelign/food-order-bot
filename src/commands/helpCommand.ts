export async function sendHelp(ctx: any) {
  await ctx.reply(
    "📖 *Help Guide*\n\n" +
      "1️⃣ Press '📦 Start Order' to begin.\n" +
      "2️⃣ Enter your name, phone, campus.\n" +
      "3️⃣ Choose restaurant and foods.\n" +
      "4️⃣ Choose delivery type.\n" +
      "5️⃣ Confirm order → sent to driver.\n\n" +
      "Admins can manage foods/restaurants/drivers.\nDrivers can view pending orders.",
    { parse_mode: "Markdown" }
  );
}
