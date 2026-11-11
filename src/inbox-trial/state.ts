import { createHash } from "node:crypto";

export const RETENTION_MS = 24 * 60 * 60_000;
export type Conversation = {
  id: string;
  name: string;
  preview: string | null;
  unread: boolean | null;
  lastMessageAt?: string | null;
  observedAt: string;
  previewObservedAt: string | null;
  unreadObservedAt: string | null;
};
export type ConversationObservation = Pick<
  Conversation,
  "id" | "name" | "preview" | "unread" | "lastMessageAt"
>;
export type TrialEvent = {
  id: string;
  conversationId: string;
  kind: "UNREAD_FOUND" | "PREVIEW_CHANGED" | "READ_STATE_CHANGED";
  at: string;
};
export type TrialStatus =
  | "STARTING"
  | "LOGIN_REQUIRED"
  | "CHALLENGE"
  | "WRONG_IDENTITY"
  | "PIN_REQUIRED"
  | "UNSUPPORTED"
  | "UNSAFE_VIEW"
  | "ONLINE"
  | "OFFLINE"
  | "STOPPED";
export type TrialState = {
  version: 1;
  scope: string;
  initialized: boolean;
  status: TrialStatus;
  reason: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  conversations: Conversation[];
  events: TrialEvent[];
  fingerprints: { id: string; at: string }[];
  unreadWindowCount?: number;
};

export function freshState(scope: string, now = new Date()): TrialState {
  return {
    version: 1,
    scope,
    initialized: false,
    status: "STARTING",
    reason: "Dang khoi dong bo thu.",
    checkedAt: now.toISOString(),
    lastSuccessAt: null,
    conversations: [],
    events: [],
    fingerprints: [],
  };
}

export function pruneState(state: TrialState, now = new Date()): TrialState {
  const recent = (at: string) => {
    const age = now.getTime() - Date.parse(at);
    return Number.isFinite(age) && age >= 0 && age < RETENTION_MS;
  };
  return {
    ...state,
    conversations: state.conversations
      .filter((c) => recent(c.observedAt))
      .map((c) => ({
        ...c,
        preview:
          c.previewObservedAt && recent(c.previewObservedAt) ? c.preview : null,
        previewObservedAt:
          c.previewObservedAt && recent(c.previewObservedAt)
            ? c.previewObservedAt
            : null,
        unread:
          c.unreadObservedAt && recent(c.unreadObservedAt) ? c.unread : null,
        unreadObservedAt:
          c.unreadObservedAt && recent(c.unreadObservedAt)
            ? c.unreadObservedAt
            : null,
      })),
    events: state.events.filter((e) => recent(e.at)),
    fingerprints: state.fingerprints.filter((f) => recent(f.at)),
  };
}

export function recordStatus(
  state: TrialState,
  status: TrialStatus,
  reason: string,
  now = new Date(),
): TrialState {
  return pruneState(
    { ...state, status, reason, checkedAt: now.toISOString() },
    now,
  );
}

export function mergeSnapshot(
  previous: TrialState,
  rows: ConversationObservation[],
  now = new Date(),
): TrialState {
  const state = pruneState(previous, now);
  const at = now.toISOString();
  const existing = new Map(state.conversations.map((c) => [c.id, c]));
  const seen = new Set(state.fingerprints.map((f) => f.id));
  const events = [...state.events];
  const fingerprints = [...state.fingerprints];
  for (const row of rows) {
    const old = existing.get(row.id);
    // Unknown fields never erase an earlier confirmed preview or read state.
    const next = {
      ...row,
      preview: row.preview ?? old?.preview ?? null,
      unread: row.unread ?? old?.unread ?? null,
      lastMessageAt: row.lastMessageAt ?? old?.lastMessageAt ?? null,
      observedAt: at,
      previewObservedAt:
        row.preview !== null ? at : (old?.previewObservedAt ?? null),
      unreadObservedAt:
        row.unread !== null ? at : (old?.unreadObservedAt ?? null),
    };
    if (previous.initialized) {
      let kind: TrialEvent["kind"] | null = null;
      if (row.unread === true && (!old || old.unread !== true))
        kind = "UNREAD_FOUND";
      else if (
        row.unread === true &&
        row.preview !== null &&
        old?.preview !== undefined &&
        old.preview !== row.preview
      )
        kind = "PREVIEW_CHANGED";
      else if (
        old &&
        row.unread !== null &&
        old.unread !== null &&
        old.unread !== row.unread
      )
        kind = "READ_STATE_CHANGED";
      if (kind) {
        const id = createHash("sha256")
          .update(JSON.stringify([row.id, kind, row.preview, row.unread]))
          .digest("hex");
        if (!seen.has(id)) {
          events.push({ id, conversationId: row.id, kind, at });
          fingerprints.push({ id, at });
          seen.add(id);
        }
      }
    }
    existing.set(row.id, next);
  }
  return {
    ...state,
    initialized: true,
    status: "ONLINE",
    reason: "Chi quan sat danh sach dang hien thi; khong phai toan bo hop thu.",
    checkedAt: at,
    lastSuccessAt: at,
    conversations: [...existing.values()],
    events,
    fingerprints,
  };
}

export function parseState(
  raw: string,
  scope: string,
  now = new Date(),
): TrialState {
  const value = JSON.parse(raw) as TrialState;
  if (
    value.version !== 1 ||
    value.scope !== scope ||
    typeof value.initialized !== "boolean" ||
    !Array.isArray(value.conversations) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.fingerprints)
  )
    throw new Error("Invalid trial state or account scope");
  return pruneState(value, now);
}
