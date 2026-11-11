"use client";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Inbox,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { cn, initials, STATUS_LABEL, type Status } from "@/lib/utils";
import type { AccountRow } from "@/lib/client";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-heading animate-enter">
      <div>
        <div className="eyebrow">
          <span />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function Avatar({
  account,
  small,
}: {
  account: Pick<AccountRow, "name" | "color">;
  small?: boolean;
}) {
  return (
    <span
      className={cn("avatar", `avatar-${account.color}`, small && "avatar-sm")}
    >
      {initials(account.name)}
    </span>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cn("status", `status-${status.toLowerCase()}`)}>
      <span />
      {STATUS_LABEL[status]}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon || <Inbox size={29} strokeWidth={1.4} />}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown | Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={22} />
      <div>
        <strong>Chưa tải được dữ liệu</strong>
        <p>{error.message}</p>
      </div>
      <Button
        variant="outline"
        loading={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await retry();
          } finally {
            setRetrying(false);
          }
        }}
      >
        <RefreshCw size={15} />
        Thử lại
      </Button>
    </div>
  );
}
export type SkeletonVariant =
  | "list"
  | "cards"
  | "posts"
  | "table"
  | "calendar"
  | "calendar-week"
  | "dashboard"
  | "inline"
  | "devices"
  | "interactions"
  | "form"
  | "inbox"
  | "inbox-detail"
  | "settings";

export function Skeleton({
  rows = 4,
  variant = "list",
  label = "Đang tải dữ liệu",
  columns = 5,
}: {
  rows?: number;
  variant?: SkeletonVariant;
  label?: string;
  columns?: number;
}) {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      <div className="skeleton skeleton-row" key={i} />
    ));
  return (
    <div
      className={cn("loading-skeleton", `loading-skeleton-${variant}`)}
      role="status"
      aria-label={label}
      aria-busy="true"
      data-variant={variant}
    >
      <div aria-hidden="true">
        {["cards", "posts", "devices", "interactions", "settings"].includes(
          variant,
        ) ? (
          <div
            className={
              variant === "posts"
                ? "post-grid"
                : variant === "devices"
                  ? "desktop-device-grid"
                  : variant === "interactions"
                    ? "interaction-grid"
                    : variant === "settings"
                      ? "settings-grid"
                      : "account-grid"
            }
          >
            {Array.from({ length: rows }, (_, i) => (
              <div
                className={`skeleton-block skeleton-card skeleton-card-${variant}`}
                key={i}
              >
                {variant === "posts" && (
                  <div className="skeleton skeleton-cover" />
                )}
                <div className="skeleton-card-content">
                  {variant === "cards" && (
                    <div className="skeleton skeleton-avatar" />
                  )}
                  <div className="skeleton skeleton-title" />
                  <div className="skeleton-stack">
                    {lines(
                      variant === "cards" || variant === "interactions" ? 5 : 3,
                    )}
                  </div>
                  <div className="skeleton-card-footer">
                    <div className="skeleton skeleton-control" />
                    <div className="skeleton skeleton-control" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : variant === "table" ? (
          <div className="panel table-wrap skeleton-table">
            <table>
              <thead>
                <tr>
                  {Array.from({ length: columns }, (_, i) => (
                    <th key={i}>
                      <div className="skeleton skeleton-row" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    {Array.from({ length: columns }, (_, j) => (
                      <td key={j}>
                        <div className="skeleton-stack">
                          <div className="skeleton skeleton-row" />
                          <div className="skeleton skeleton-row" />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : variant === "form" ? (
          <div className="panel auto-interactions skeleton-form">
            <div className="skeleton-stack">
              <div className="skeleton skeleton-title" />
              {lines(2)}
            </div>
            <div className="skeleton-form-options">{lines(3)}</div>
            <div className="skeleton-form-fields">{lines(2)}</div>
            <div className="skeleton-form-options skeleton-form-days">
              {lines(2)}
            </div>
            <div className="skeleton skeleton-control" />
            <div className="skeleton skeleton-form-note" />
            <div className="skeleton skeleton-form-note" />
            <div className="skeleton-card-footer">
              <div className="skeleton skeleton-control" />
              <div className="skeleton skeleton-control" />
            </div>
          </div>
        ) : variant === "inbox" ? (
          <div className="skeleton-inbox">
            <div className="skeleton-inbox-summary">
              <div className="skeleton skeleton-avatar" />
              <div className="skeleton-stack">{lines(2)}</div>
            </div>
            <div className="inbox-account-list">
              {Array.from({ length: rows }, (_, i) => (
                <div className="panel inbox-account-card" key={i}>
                  <div className="skeleton skeleton-avatar" />
                  <div className="skeleton-stack">{lines(2)}</div>
                  <div className="skeleton skeleton-date" />
                </div>
              ))}
            </div>
          </div>
        ) : variant === "inbox-detail" ? (
          <div className="skeleton-inbox">
            <div className="skeleton-block skeleton-stack">{lines(3)}</div>
            <div className="inbox-layout">
              <div className="skeleton-block skeleton-stack">{lines(rows)}</div>
              <div className="skeleton-block skeleton-inbox-preview">
                <div className="skeleton skeleton-title" />
                {lines(3)}
              </div>
            </div>
          </div>
        ) : variant === "calendar" || variant === "calendar-week" ? (
          <div className="skeleton-calendar">
            {Array.from(
              { length: variant === "calendar-week" ? 7 : 35 },
              (_, i) => (
                <div className="skeleton-calendar-cell" key={i}>
                  <div className="skeleton skeleton-date" />
                  {i % 3 === 0 && <div className="skeleton skeleton-row" />}
                </div>
              ),
            )}
          </div>
        ) : variant === "dashboard" ? (
          <>
            <div className="skeleton skeleton-hero" />
            <div className="stats-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="skeleton-block" key={i}>
                  <div className="skeleton skeleton-title" />
                  <div className="skeleton skeleton-number" />
                  <div className="skeleton skeleton-row" />
                </div>
              ))}
            </div>
            <div className="dashboard-columns">
              <div className="skeleton-block">{lines(rows)}</div>
              <div className="skeleton-block">{lines(3)}</div>
            </div>
          </>
        ) : (
          <div
            className={
              variant === "inline" ? "skeleton-inline" : "skeleton-block"
            }
          >
            {variant !== "inline" && (
              <div className="skeleton skeleton-title" />
            )}
            {lines(rows)}
          </div>
        )}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Tìm kiếm…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button aria-label="Xóa tìm kiếm" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {Math.min((page - 1) * size + 1, total)}–{Math.min(page * size, total)}{" "}
        / {total} mục
      </span>
      <div>
        <Button
          variant="outline"
          size="icon"
          disabled={page <= 1}
          aria-label="Trang trước"
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </Button>
        <span>
          Trang {page}/{pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={page >= pages}
          aria-label="Trang sau"
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  onConfirm,
  loading,
  confirmLabel = "Xác nhận",
  notice = "Thao tác này có thể ảnh hưởng các công việc đang chờ. Hãy kiểm tra trước khi tiếp tục.",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
  confirmLabel?: string;
  notice?: string | null;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v && !loading) onClose();
      }}
      title={title}
      description={description}
    >
      {notice && (
        <div className="notice notice-amber">
          <AlertCircle size={18} />
          <p>{notice}</p>
        </div>
      )}
      <div className="dialog-footer">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Quay lại
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
