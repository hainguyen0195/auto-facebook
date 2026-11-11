export function calendarRange(cursor: Date, view: "month" | "week") {
  const first =
    view === "month"
      ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1))
      : new Date(
          Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate(),
          ),
        );
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86400_000);
  const length = view === "month" ? 42 : 7;
  const days = Array.from(
    { length },
    (_, i) => new Date(start.getTime() + i * 86400_000),
  );
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return {
    days,
    start: `${key(start)}T00:00:00+07:00`,
    end: `${key(new Date(start.getTime() + length * 86400_000))}T00:00:00+07:00`,
  };
}
