"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import { dateKey, localInput } from "@/lib/utils";
import { Select } from "./select";

// Calendar arithmetic uses UTC; the value is a calendar day, not a browser-local instant.
const fromKey = (key: string) => new Date(`${key}T12:00:00Z`);
const toKey = (date: Date) => date.toISOString().slice(0, 10);
const offsetDay = (key: string, offset: number) => {
  const date = fromKey(key);
  date.setUTCDate(date.getUTCDate() + offset);
  return toKey(date);
};
const offsetMonth = (key: string, offset: number) => {
  const date = fromKey(key),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return toKey(date);
};
const dayLabel = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", ...options }).format(
    fromKey(key),
  );
const fullDayLabel = (key: string) =>
  dayLabel(key, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

type DatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-label"?: string;
};

export function DatePicker({
  value,
  onValueChange,
  id,
  disabled,
  required,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const generatedId = useId(),
    headingId = useId();
  const [open, setOpen] = useState(false);
  const today = dateKey();
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  const [focused, setFocused] = useState(selected);
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [view, setView] = useState<"days" | "months">("days");
  const content = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = `${month}-01`;
  const start = offsetDay(first, -((fromKey(first).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => offsetDay(start, i));
  const year = Number(month.slice(0, 4));

  function changeOpen(next: boolean) {
    if (next) {
      setFocused(selected);
      setMonth(selected.slice(0, 7));
      setView("days");
    }
    setOpen(next);
  }
  function choose(key: string) {
    onValueChange(key);
    setOpen(false);
  }
  function moveMonth(offset: number) {
    const next = offsetMonth(`${month}-${focused.slice(8, 10)}`, offset);
    setMonth(next.slice(0, 7));
    setFocused(next);
  }
  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const weekday = (fromKey(key).getUTCDay() + 6) % 7;
    let next: string;
    switch (event.key) {
      case "ArrowLeft":
        next = offsetDay(key, -1);
        break;
      case "ArrowRight":
        next = offsetDay(key, 1);
        break;
      case "ArrowUp":
        next = offsetDay(key, -7);
        break;
      case "ArrowDown":
        next = offsetDay(key, 7);
        break;
      case "Home":
        next = offsetDay(key, -weekday);
        break;
      case "End":
        next = offsetDay(key, 6 - weekday);
        break;
      case "PageUp":
        next = offsetMonth(key, event.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = offsetMonth(key, event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    focusDay.current = true;
    setFocused(next);
    setMonth(next.slice(0, 7));
  }

  return (
    <>
      {required && (
        <input
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          required
          disabled={disabled}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onInvalid={(e) => {
            e.preventDefault();
            trigger.current?.focus();
            changeOpen(true);
          }}
        />
      )}
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            ref={trigger}
            id={id || generatedId}
            type="button"
            className="date-picker-trigger"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-required={required}
          >
            <span className="date-picker-icon">
              <CalendarDays size={19} aria-hidden="true" />
            </span>
            <span className="date-picker-value">
              <strong>
                {value
                  ? dayLabel(selected, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                  : "Chọn ngày"}
              </strong>
              <small>
                {selected === today
                  ? "Hôm nay"
                  : dayLabel(selected, { weekday: "long" })}
              </small>
            </span>
            <ChevronDown
              size={16}
              className="date-picker-chevron"
              aria-hidden="true"
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={content}
            className="date-picker-content"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Chọn ngày"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              content.current
                ?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
                ?.focus();
            }}
          >
            <div className="date-picker-caption">
              <CalendarDays size={15} aria-hidden="true" />
              <span>Chọn một ngày</span>
            </div>
            <div
              className="date-picker-shortcuts"
              role="group"
              aria-label="Chọn ngày nhanh"
            >
              {[
                ["Hôm qua", -1],
                ["Hôm nay", 0],
                ["Ngày mai", 1],
              ].map(([label, offset]) => {
                const key = offsetDay(today, Number(offset));
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={value === key}
                    onClick={() => choose(key)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="date-picker-nav">
              <button
                type="button"
                className="date-picker-arrow"
                aria-label={view === "days" ? "Tháng trước" : "Năm trước"}
                onClick={() => moveMonth(view === "days" ? -1 : -12)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                id={headingId}
                className="date-picker-month"
                aria-label={
                  view === "days"
                    ? "Chọn tháng và năm"
                    : "Xem các ngày trong tháng"
                }
                onClick={() => setView(view === "days" ? "months" : "days")}
                aria-live="polite"
              >
                {view === "days"
                  ? `Tháng ${Number(month.slice(5, 7))}, ${year}`
                  : year}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="date-picker-arrow"
                aria-label={view === "days" ? "Tháng sau" : "Năm sau"}
                onClick={() => moveMonth(view === "days" ? 1 : 12)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            {view === "months" ? (
              <div
                className="date-picker-months"
                role="group"
                aria-label={`Các tháng năm ${year}`}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={month === key}
                      onClick={() => {
                        setMonth(key);
                        setFocused(`${key}-01`);
                        focusDay.current = true;
                        setView("days");
                      }}
                    >
                      Tháng {i + 1}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                role="grid"
                aria-labelledby={headingId}
                className="date-picker-grid"
              >
                <div role="row" className="date-picker-weekdays">
                  {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => (
                    <span role="columnheader" key={day}>
                      {day}
                    </span>
                  ))}
                </div>
                {Array.from({ length: 6 }, (_, row) => (
                  <div role="row" className="date-picker-week" key={row}>
                    {days.slice(row * 7, row * 7 + 7).map((key) => (
                      <div
                        role="gridcell"
                        aria-selected={value === key}
                        key={key}
                      >
                        <button
                          type="button"
                          data-day={key}
                          data-outside={key.slice(0, 7) !== month || undefined}
                          data-selected={value === key || undefined}
                          aria-label={fullDayLabel(key)}
                          aria-current={key === today ? "date" : undefined}
                          tabIndex={focused === key ? 0 : -1}
                          ref={(node) => {
                            if (node && focused === key && focusDay.current) {
                              focusDay.current = false;
                              node.focus();
                            }
                          }}
                          onFocus={() => setFocused(key)}
                          onKeyDown={(e) => onDayKey(e, key)}
                          onClick={() => choose(key)}
                        >
                          {Number(key.slice(8))}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="date-picker-footer">
              <span className="date-picker-today-dot" />
              Hôm nay ·{" "}
              {dayLabel(today, {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

export function DateTimePicker({
  value,
  onValueChange,
  ...props
}: DatePickerProps) {
  const current = value || localInput();
  const [date, time] = current.split("T");
  const [hour, minute] = time.split(":");
  return (
    <div className="date-time-picker">
      <DatePicker
        {...props}
        value={value ? date : ""}
        onValueChange={(next) => onValueChange(`${next}T${hour}:${minute}`)}
      />
      <div className="date-time-clock">
        <Clock3 size={16} aria-hidden="true" />
        <Select
          aria-label="Giờ"
          disabled={props.disabled}
          value={hour}
          onValueChange={(next) => onValueChange(`${date}T${next}:${minute}`)}
        >
          {Array.from({ length: 24 }, (_, i) => {
            const v = String(i).padStart(2, "0");
            return (
              <option key={v} value={v}>
                {v} giờ
              </option>
            );
          })}
        </Select>
        <span aria-hidden="true">:</span>
        <Select
          aria-label="Phút"
          disabled={props.disabled}
          value={minute}
          onValueChange={(next) => onValueChange(`${date}T${hour}:${next}`)}
        >
          {Array.from({ length: 60 }, (_, i) => {
            const v = String(i).padStart(2, "0");
            return (
              <option key={v} value={v}>
                {v} phút
              </option>
            );
          })}
        </Select>
      </div>
    </div>
  );
}
