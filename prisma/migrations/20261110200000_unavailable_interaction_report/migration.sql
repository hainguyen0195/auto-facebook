ALTER TABLE "Interaction"
  ADD COLUMN "skipReason" TEXT,
  ADD COLUMN "unavailableAt" TIMESTAMP(3);

CREATE INDEX "Interaction_workspaceId_skipReason_unavailableAt_idx"
  ON "Interaction"("workspaceId", "skipReason", "unavailableAt");

-- Older runners already report this exact diagnostic before any submission.
WITH classified AS (
  UPDATE "Interaction"
  SET status = 'SKIPPED', phase = 'DONE', "nextAttemptAt" = NULL,
      "skipReason" = 'TARGET_UNAVAILABLE', "unavailableAt" = "updatedAt",
      "reactionState" = CASE WHEN "reactionState" IN ('NONE', 'COMPLETED') THEN "reactionState" ELSE 'SKIPPED' END,
      "commentState" = CASE WHEN "commentState" IN ('NONE', 'COMPLETED') THEN "commentState" ELSE 'SKIPPED' END,
      version = version + 1
  WHERE status = 'FAILED' AND "executionMode" = 'AUTOMATIC'
    AND note LIKE 'Chưa thực hiện tương tác; lỗi ở bước kiểm tra phiên và mở bài: Bài không thể truy cập bằng tài khoản đã chọn; kiểm tra quyền nhóm hoặc bài đã bị xóa.%'
  RETURNING id, "runId", "unavailableAt"
)
INSERT INTO "InteractionEvent" (id, "interactionId", "runId", "fromStatus", "toStatus", note, "createdAt")
SELECT 'unavailable-' || id, id, "runId", 'FAILED', 'SKIPPED',
  'Đã phân loại báo cáo cũ: link không khả dụng với tài khoản được giao. Bỏ qua bài, không tự thử lại hoặc đổi tài khoản.',
  CURRENT_TIMESTAMP
FROM classified;
