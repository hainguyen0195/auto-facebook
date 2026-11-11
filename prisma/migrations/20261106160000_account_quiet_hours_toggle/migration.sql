ALTER TABLE "FacebookAccount" ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Equal hours were the previous way to allow work throughout the day.
UPDATE "FacebookAccount" SET "quietHoursEnabled" = false WHERE "quietStart" = "quietEnd";
