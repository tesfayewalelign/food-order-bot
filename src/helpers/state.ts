export interface FoodItem {
  name: string;
  quantity: number;
  price: number;
}

export interface UserState {
  step:
    | "profile_ask_name"
    | "profile_ask_phone"
    | "profile_ask_campus"
    | "ask_restaurant"
    | "select_food"
    | "waiting_for_quantity"
    | "choose_delivery_type"
    | "confirm_order";
  foods: FoodItem[];
  currentFood?: string;
  currentFoodPrice?: number;
  deliveryType?: "new" | "contract";
  restaurant: string;
  campus: string;
  name: string;
  phone: string;
  cartFoods: [];
  restaurantId?: number;
}

export const userState = new Map<number, UserState>();

export const resetUserState = (userId: number) => {
  userState.delete(userId);
};
