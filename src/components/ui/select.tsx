"use client";

import {
  Children,
  isValidElement,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY = "__nhipdang_empty__";
function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : typeof child === "string" || typeof child === "number"
          ? String(child)
          : "",
    )
    .join("");
}
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function Select({
  children,
  value,
  onValueChange,
  id,
  className,
  disabled,
  required,
  name,
  onBlur,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  children: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}) {
  const labelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = Children.toArray(children).filter(
    (child) => isValidElement(child) && child.type === "option",
  ) as ReactElement<{
    value: string;
    disabled?: boolean;
    children: ReactNode;
  }>[];
  const selected = options.find((option) => option.props.value === value);
  return (
    <>
      {(name || required) && (
        <select
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onInvalid={(event) => {
            event.preventDefault();
            trigger.current?.focus();
            setSearch("");
            setOpen(true);
          }}
        >
          {!options.some((option) => option.props.value === "") && (
            <option value="" />
          )}
          {options}
        </select>
      )}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setSearch("");
          setOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
            disabled={disabled}
            id={id}
            className={cn("select-trigger", className)}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel || id ? undefined : labelId}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSearch("");
                setOpen(true);
              }
            }}
          >
            <span id={labelId} className="select-value">
              {selected?.props.children || "Chọn…"}
            </span>
            <span>
              <ChevronDown size={15} />
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="select-content"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Chọn từ danh sách"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus({ preventScroll: true });
            }}
          >
            <Command
              label="Tìm trong danh sách"
              defaultValue={value || EMPTY}
              loop
              filter={(_value, query, keywords) => {
                const label = normalize((keywords || []).join(" "));
                return label.includes(normalize(query)) ? 1 : 0;
              }}
            >
              <div className="select-search">
                <Search size={16} aria-hidden="true" />
                <Command.Input
                  ref={input}
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Tìm trong danh sách…"
                  autoComplete="off"
                  spellCheck={false}
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Xóa từ khóa trong danh sách"
                    onClick={() => {
                      setSearch("");
                      input.current?.focus();
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <Command.List className="select-viewport" label="Các lựa chọn">
                <Command.Empty className="select-empty">
                  Không tìm thấy lựa chọn phù hợp.
                </Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.props.value}
                    value={option.props.value || EMPTY}
                    keywords={[textContent(option.props.children)]}
                    disabled={option.props.disabled}
                    className="select-item"
                    data-checked={option.props.value === value || undefined}
                    onSelect={() => {
                      onValueChange(option.props.value);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span>{option.props.children}</span>
                    {option.props.value === value && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
