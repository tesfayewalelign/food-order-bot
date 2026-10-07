import { db } from "../config/db.js";

export interface SpecialOrderSettings {
  minDeliveryFee: number;
  pricePerKm: number;
}

export async function getSpecialOrderSettings(): Promise<SpecialOrderSettings> {
  try {
    const minRes = await db.execute("SELECT value FROM special_order_settings WHERE key = 'min_delivery_fee'");
    const kmRes = await db.execute("SELECT value FROM special_order_settings WHERE key = 'price_per_km'");

    const minDeliveryFee = minRes.rows[0]?.value ? Number(minRes.rows[0].value) : 50;
    const pricePerKm = kmRes.rows[0]?.value ? Number(kmRes.rows[0].value) : 20;

    return {
      minDeliveryFee: isNaN(minDeliveryFee) ? 50 : minDeliveryFee,
      pricePerKm: isNaN(pricePerKm) ? 20 : pricePerKm,
    };
  } catch (err) {
    console.error("[SpecialOrderSettings] Error fetching settings:", err);
    return { minDeliveryFee: 50, pricePerKm: 20 };
  }
}

export async function updateSpecialOrderSettings(minDeliveryFee: number, pricePerKm: number): Promise<void> {
  await db.execute({
    sql: "INSERT INTO special_order_settings (key, value) VALUES ('min_delivery_fee', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [String(minDeliveryFee)],
  });
  await db.execute({
    sql: "INSERT INTO special_order_settings (key, value) VALUES ('price_per_km', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [String(pricePerKm)],
  });
}

export function calculateSpecialDeliveryFee(
  distanceKm: number,
  minDeliveryFee: number = 50,
  pricePerKm: number = 20
): number {
  const dist = Math.max(0, distanceKm || 0);
  return minDeliveryFee + dist * pricePerKm;
}
