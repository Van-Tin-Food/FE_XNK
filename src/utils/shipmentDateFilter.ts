function shiftMonth(date: Date, amount: number): Date {
  const shifted = new Date(date);
  const day = shifted.getDate();
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + amount);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDefaultEtaRange(now = new Date()): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: toDateInputValue(shiftMonth(now, -1)),
    dateTo: toDateInputValue(shiftMonth(now, 2)),
  };
}