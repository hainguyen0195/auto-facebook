import { Skeleton, type SkeletonVariant } from "./common";

type Page =
  | "today"
  | "accounts"
  | "posts"
  | "groups"
  | "calendar"
  | "history"
  | "inbox"
  | "desktop"
  | "interactions"
  | "settings"
  | "guide";

const layouts: Record<
  Page,
  {
    variant: SkeletonVariant;
    rows: number;
    columns?: number;
    toolbar?: boolean;
  }
> = {
  today: { variant: "dashboard", rows: 4 },
  accounts: { variant: "cards", rows: 3, toolbar: true },
  posts: { variant: "posts", rows: 3, toolbar: true },
  groups: { variant: "table", rows: 6, columns: 5, toolbar: true },
  calendar: { variant: "calendar", rows: 6, toolbar: true },
  history: { variant: "table", rows: 6, columns: 6, toolbar: true },
  inbox: { variant: "inbox", rows: 4 },
  desktop: { variant: "devices", rows: 2 },
  interactions: { variant: "form", rows: 1 },
  settings: { variant: "settings", rows: 4 },
  guide: { variant: "settings", rows: 6, toolbar: true },
};

export function PageSkeleton({ page }: { page: Page }) {
  const layout = layouts[page];
  return (
    <div className="page-skeleton">
      <div className="page-heading skeleton-page-heading" aria-hidden="true">
        <div className="skeleton-stack">
          <div className="skeleton skeleton-eyebrow" />
          <div className="skeleton skeleton-page-title" />
          <div className="skeleton skeleton-row" />
        </div>
        <div className="skeleton skeleton-control" />
      </div>
      {layout.toolbar && (
        <div className="skeleton-toolbar" aria-hidden="true">
          <div className="skeleton skeleton-control" />
          <div className="skeleton skeleton-control" />
        </div>
      )}
      {page === "desktop" && (
        <div className="skeleton-block skeleton-route-intro" aria-hidden="true">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-row" />
        </div>
      )}
      <Skeleton {...layout} label="Đang tải trang" />
      {page === "interactions" && (
        <Skeleton
          variant="interactions"
          rows={2}
          label="Đang tải danh sách công việc"
        />
      )}
      {page === "desktop" && (
        <Skeleton
          variant="cards"
          rows={3}
          label="Đang tải danh sách tài khoản"
        />
      )}
    </div>
  );
}
