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

export interface SpecialOrderItem {
  name: string;
  quantity: number;
  customerPrice?: number | null;
}

export interface UserState {
  step:
    | "idle"
    | "profile_ask_name"
    | "profile_ask_phone"
    | "profile_ask_campus"
    | "ask_restaurant"
    | "ask_restaurant_contract"
    | "ask_delivery_contract"
    | "select_food"
    | "waiting_for_quantity"
    | "waiting_for_custom_quantity"
    | "choose_delivery_type"
    | "confirm_order"
    | "select_meal_type"
    | "ask_custom_price"
    | "custom_restaurant_name"
    | "custom_food_name"
    | "ask_payment_mode"
    | "waiting_for_complaint"
    | "so_ask_campus"
    | "so_choose_restaurant"
    | "so_custom_restaurant"
    | "so_choose_location"
    | "so_custom_location"
    | "so_ask_food_name"
    | "so_ask_quantity"
    | "so_ask_custom_quantity"
    | "so_ask_price_knowledge"
    | "so_ask_item_price"
    | "so_confirm_review";

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
  isRider?: boolean;
  paymentMode?: "normal" | "restaurant_contract";

  hasRestaurantContract?: boolean;
  hasDeliveryContract?: boolean;
  isSubmittingOrder?: boolean;

  // Special Order fields
  soDeliveryCampus?: string;
  soRestaurant?: string;
  soRestaurantId?: number | null;
  soLocation?: string;
  soItems?: SpecialOrderItem[];
  soCurrentFoodName?: string;
  soCurrentItemIndex?: number;
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
