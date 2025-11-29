export function getEthiopianTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ethiopiaOffset = 3 * 60 * 60 * 1000;
  return new Date(utc + ethiopiaOffset);
}

export function isOrderTime(): boolean {
  const now = getEthiopianTime();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const lunchStart = 13 * 60;
  const lunchEnd = 16 * 60 + 30;
  const dinnerStart = 20 * 60 + 30;
  const dinnerEnd = 23 * 60 + 30;

  return (
    (timeInMinutes >= lunchStart && timeInMinutes <= lunchEnd) ||
    (timeInMinutes >= dinnerStart && timeInMinutes <= dinnerEnd)
  );
}

export function nextOrderWindow(): string {
  const now = getEthiopianTime();
  const timeInMinutes = now.getHours() * 60 + now.getMinutes();

  if (timeInMinutes < 13 * 60) return "Lunch starts at 1:00 PM";
  if (timeInMinutes < 20 * 60 + 30) return "Dinner starts at 8:30 PM";
  return "Next lunch ordering starts at 1:00 PM tomorrow";
}
