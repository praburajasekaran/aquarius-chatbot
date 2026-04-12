export const FIRM_CONTACT = {
  phone: "+61 2 8858 3233",
  phoneHref: "tel:+61288583233",
  businessHours: "10:00am – 5:00pm AEST, Mon–Fri",
  timezone: "Australia/Sydney",
  businessHoursWindow: {
    startHour: 10,
    endHour: 17,
    weekdays: [1, 2, 3, 4, 5] as const,
  },
} as const;

export function isInsideBusinessHours(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: FIRM_CONTACT.timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[weekdayShort] ?? -1;

  const inWeekday = (FIRM_CONTACT.businessHoursWindow.weekdays as readonly number[]).includes(weekday);
  const inHour =
    hour >= FIRM_CONTACT.businessHoursWindow.startHour &&
    hour < FIRM_CONTACT.businessHoursWindow.endHour;

  return inWeekday && inHour;
}
