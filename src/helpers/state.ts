export interface UserState {
  step: string;
  name?: string;
  phone?: string;
  campus?: string;
  restaurant?: string;
  food?: string;
  count?: number;
  cartFoods?: any[];
}
export interface User {
  telegram_id: number;
  phone: string;
  name: string;
  campus: string;
  is_contract: boolean;
  remaining_contract: number | null;
}

export const userState = new Map<number, UserState>();

export function resetUserState(userId: number) {
  userState.delete(userId);
}
