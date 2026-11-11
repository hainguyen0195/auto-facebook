import { describe, expect, it } from "vitest";
import {
  isFacebookTarget,
  matchesFacebookDestination,
} from "../../src/desktop/facebook";
describe("Facebook publishing destination", () => {
  it("only accepts Facebook HTTPS destinations", () => {
    expect(isFacebookTarget("https://www.facebook.com/groups/shop")).toBe(true);
    expect(isFacebookTarget("https://facebook.com.evil.test/groups/shop")).toBe(
      false,
    );
    expect(
      isFacebookTarget("https://name:password@facebook.com/groups/shop"),
    ).toBe(false);
    expect(isFacebookTarget("http://facebook.com/groups/shop")).toBe(false);
  });
  it("does not allow a group redirect to become a personal or different group post", () => {
    const target = "https://www.facebook.com/groups/shop";
    expect(
      matchesFacebookDestination(target, target + "/?locale=vi_VN", true),
    ).toBe(true);
    expect(
      matchesFacebookDestination(target, "https://www.facebook.com/", true),
    ).toBe(false);
    expect(
      matchesFacebookDestination(
        target,
        "https://www.facebook.com/groups/other",
        true,
      ),
    ).toBe(false);
    expect(
      matchesFacebookDestination(
        target,
        "https://www.facebook.com/groups/shop-else",
        true,
      ),
    ).toBe(false);
  });
  it("accepts the official web.facebook.com redirect only for the same destination", () => {
    const target = "https://www.facebook.com/groups/shop";
    expect(
      matchesFacebookDestination(
        target,
        "https://web.facebook.com/groups/shop/?locale=vi_VN",
        true,
      ),
    ).toBe(true);
    expect(
      matchesFacebookDestination(
        target,
        "https://web.facebook.com/groups/other",
        true,
      ),
    ).toBe(false);
    expect(
      matchesFacebookDestination(target, "https://web.facebook.com/", true),
    ).toBe(false);
    expect(
      isFacebookTarget("https://web.facebook.com.evil.test/groups/shop"),
    ).toBe(false);
    expect(isFacebookTarget("https://web.facebook.com:8443/groups/shop")).toBe(
      false,
    );
  });
  it("requires the exact personal destination, including numeric profile identity", () => {
    const target = "https://www.facebook.com/profile.php?id=123";
    expect(
      matchesFacebookDestination(target, target + "&locale=vi_VN", false),
    ).toBe(true);
    expect(
      matchesFacebookDestination(
        target,
        "https://www.facebook.com/profile.php?id=456",
        false,
      ),
    ).toBe(false);
    expect(
      matchesFacebookDestination(
        "https://www.facebook.com/shop",
        "https://www.facebook.com/other",
        false,
      ),
    ).toBe(false);
  });
});
