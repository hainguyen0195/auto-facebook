ALTER TABLE "Group" RENAME COLUMN "minIntervalHours" TO "minIntervalMinutes";
UPDATE "Group" SET "minIntervalMinutes" = "minIntervalMinutes" * 60;
ALTER TABLE "Group" ALTER COLUMN "minIntervalMinutes" SET DEFAULT 5;
ALTER TABLE "FacebookAccount" ADD COLUMN "postIntervalMinutes" INTEGER NOT NULL DEFAULT 5;
