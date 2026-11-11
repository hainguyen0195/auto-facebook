import { expect, it } from "vitest";
import { browserCommandFailure } from "../../src/desktop/command-errors";

it.each([
  [
    "browserType.launchPersistentContext: Executable doesn't exist at /private/profile",
    "chưa tìm thấy trình duyệt",
  ],
  ["ProcessSingleton: profile is in use", "tiến trình khác"],
  ["page.goto: net::ERR_ABORTED", "chuyển hướng"],
  ["page.goto: net::ERR_INTERNET_DISCONNECTED", "Kiểm tra mạng"],
  ["page.goto: Timeout 45000ms exceeded", "Kiểm tra mạng"],
  ["Target page, context or browser has been closed", "đã đóng"],
])("distinguishes a browser command failure: %s", (detail, expected) => {
  const message = browserCommandFailure("CHECK", new Error(detail));
  expect(message).toContain(expected);
  expect(message).not.toContain("/private/profile");
});

it("does not advise reinstalling a browser for an unknown session-check failure", () => {
  const message = browserCommandFailure(
    "CHECK",
    new Error("private internal error"),
  );
  expect(message).toContain("Chưa kiểm tra được phiên");
  expect(message).not.toContain("Chromium");
  expect(message).not.toContain("private internal error");
});
