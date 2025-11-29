export interface FoodItem {
  name: string;
  quantity: number;
  price: number;
}
export interface User {
  id: number;
  telegram_id: number | null;
  phone: string;
  name: string | null;
  campus: string | null;
  is_contract: boolean;
  contract_count: number;
  created_at: string;
  username: string;
}

export interface UserState {
  step:
    | "idle"
    | "profile_ask_name"
    | "profile_ask_phone"
    | "profile_ask_campus"
    | "ask_restaurant"
    | "select_food"
    | "waiting_for_quantity"
    | "choose_delivery_type"
    | "confirm_order"
    | "select_meal_type"
    | "custom_restaurant_name";

  foods: FoodItem[];

  currentFood?: string;
  currentFoodPrice?: number;

  deliveryType?: "new" | "contract";

  restaurant?: string;
  campus?: string;
  name?: string;
  phone?: string;
  username?: string;

  cartFoods: any[];

  restaurantId?: string;
  mealType?: string;
}

export const userState = new Map<number, UserState>();

export const resetUserState = (userId: number) => {
  userState.set(userId, {
    step: "idle",
    foods: [],
    cartFoods: [],
  });
};

export async function initUserState(userId: number, profile?: any | null) {
  const state: UserState = {
    step: profile ? "idle" : "profile_ask_name",

    name: profile?.name ?? null,
    phone: profile?.phone ?? null,
    campus: profile?.campus ?? null,
    foods: [],
    cartFoods: [],
    restaurant: undefined,
    restaurantId: undefined,
    currentFood: undefined,
    currentFoodPrice: undefined,
    deliveryType: undefined,
  };

  userState.set(userId, state);
  return state;
}
