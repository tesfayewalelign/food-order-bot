export type UserState = {
  step?:
    | "ask_name"
    | "ask_phone"
    | "ask_campus"
    | "ask_restaurant"
    | "ask_name"
    | "select_food"
    | "waiting_for_quantity"
    | "choose_delivery_type"
    | "confirm_order"
    | "profile_ask_name"
    | "profile_ask_phone"
    | "profile_ask_campus"
    | "profile_ask_dorm"
    | undefined;
  foods: { name: string; quantity: number }[];
  cartFoods: { name: string; quantity: number }[];
  currentFood: string | undefined;
  deliveryType: "new" | "contract" | undefined;
  restaurant: string | undefined;
  campus: string | undefined;
  name: string | undefined;
  phone: string | undefined;
  orderId?: number;
};

export interface User {
  telegram_id: number;
  phone: string;
  name: string;
  campus: string;
  is_contract: boolean;
  contract_count?: number;
}

export const userState = new Map<number, UserState>();

export function resetUserState(userId: number) {
  userState.delete(userId);
}
