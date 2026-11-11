"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new ApiError(
      "Mất kết nối. Nội dung bạn nhập vẫn được giữ, hãy thử lại.",
      0,
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.location.assign("/login");
    throw new ApiError(
      data.error || "Không thể xử lý yêu cầu. Hãy thử lại.",
      response.status,
      data.details,
    );
  }
  return data as T;
}
export function useResource<T>(
  path: string,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<T, Error>({
    queryKey: [path],
    queryFn: () => api<T>(path),
    staleTime: 15_000,
    retry: (count, error) =>
      count < 1 && (!(error instanceof ApiError) || error.status >= 500),
    ...options,
  });
}
export function useAction<TInput, TOutput = unknown>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries();
      if (success) toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export type AccountRow = {
  id: string;
  name: string;
  url: string;
  profileName: string;
  color: "teal" | "blue" | "amber" | "rose" | "slate";
  status: "ACTIVE" | "PAUSED" | "RESTRICTED";
  dailyLimit: number;
  postIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  note: string;
  _count?: { memberships: number };
};
export type GroupRow = {
  id: string;
  name: string;
  url: string;
  tags: string[];
  rules: string;
  minIntervalMinutes: number;
  memberships: { accountId: string; account: AccountRow }[];
};
export type AssetRow = {
  id: string;
  originalName: string;
  size: number;
  mime: string;
};
export type PostScheduleAccount = Pick<AccountRow, "id" | "name" | "color"> & {
  taskCount: number;
  byStatus: Record<import("./utils").Status, number>;
  archivedCount: number;
  archivedUnfinishedCount: number;
};
export type PostScheduleTask = Pick<
  TaskRow,
  | "id"
  | "accountId"
  | "scheduledAt"
  | "recordedAt"
  | "status"
  | "note"
  | "blockReason"
  | "automaticPhase"
  | "archivedAt"
  | "resultUrl"
> & {
  account: Pick<AccountRow, "id" | "name" | "color">;
  group: { name: string } | null;
};
export type PostRow = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  version: number;
  updatedAt: string;
  assets: { assetId: string; asset: AssetRow; position: number }[];
  _count: { tasks: number };
  scheduledAccounts?: PostScheduleAccount[];
};
export type TaskRow = {
  id: string;
  accountId: string;
  groupId: string | null;
  campaignId: string;
  account: AccountRow;
  group: GroupRow | null;
  titleSnapshot: string;
  contentSnapshot: string;
  assetIds: string[];
  scheduledAt: string;
  status: import("./utils").Status;
  note: string;
  resultUrl: string | null;
  recordedAt: string | null;
  startedAt: string | null;
  version: number;
  blockReason: string | null;
  executionMode: "MANUAL" | "AUTOMATIC";
  resultSource: string;
  automaticPhase: string;
  automaticAttempts?: number;
  nextAttemptAt?: string | null;
  automaticHold?: string | null;
  archivedAt?: string | null;
  automaticWait?: {
    reason: "GROUP_INTERVAL" | "ACCOUNT_INTERVAL" | "RETRY_BACKOFF";
    minutes: number;
    until: string;
  } | null;
  assets?: AssetRow[];
  events?: {
    id: string;
    fromStatus: import("./utils").Status;
    toStatus: import("./utils").Status;
    source: string;
    note: string;
    createdAt: string;
  }[];
};
export type PageData<T> = {
  items: T[];
  total: number;
  page: number;
  size: number;
};
export type CalendarData = {
  days: {
    date: string;
    total: number;
    items: (Pick<TaskRow, "id" | "titleSnapshot" | "scheduledAt" | "status"> & {
      account: { name: string };
      group: { name: string } | null;
    })[];
  }[];
  total: number;
  summary: Partial<Record<import("./utils").Status, number>>;
};
export type Bootstrap = {
  workspace: { id: string; name: string; timezone: string };
  user: { id: string; name: string; email: string };
};
export type DashboardData = {
  due: number;
  overdue: number;
  published: number;
  pending: number;
  accountCount: number;
  groupCount: number;
  postCount: number;
  pausedCount: number;
  queue: TaskRow[];
  upcoming: TaskRow[];
  notifications: { id: string; task: TaskRow }[];
  week: { date: string; published: number; pending: number }[];
  progress: {
    date: string;
    total: number;
    handled: number;
    pending: number;
    byStatus: Record<import("./utils").Status, number>;
    remainingTasks: (Pick<
      TaskRow,
      | "id"
      | "titleSnapshot"
      | "scheduledAt"
      | "status"
      | "note"
      | "blockReason"
      | "automaticPhase"
    > & { account: { name: string }; group: { name: string } | null })[];
  };
};
