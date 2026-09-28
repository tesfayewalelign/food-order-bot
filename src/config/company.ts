import dotenv from "dotenv";
dotenv.config();

export const COMPANY_CONTACT = {
  name: process.env.COMPANY_NAME || "Campus Food Delivery",
  phone: process.env.COMPANY_PHONE_NUMBER || "+251 900 000 000",
  telegram: process.env.COMPANY_TELEGRAM_SUPPORT || "@CampusFoodSupport",
};
