import {
  createParser,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";
import { STATUSES } from "./utils";

const dateParser = createParser({
  parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? value
      : null;
  },
  serialize: (value: string) => value,
});

export const calendarFilters = {
  view: parseAsStringLiteral(["month", "week", "list"]).withDefault("month"),
  date: dateParser,
  day: dateParser,
  q: parseAsString.withDefault(""),
  status: parseAsStringLiteral(["", ...STATUSES]).withDefault(""),
  remaining: parseAsBoolean.withDefault(false),
  accountId: parseAsString.withDefault(""),
  target: parseAsStringLiteral(["", "PROFILE", "GROUP"]).withDefault(""),
  page: parseAsInteger.withDefault(1),
};
