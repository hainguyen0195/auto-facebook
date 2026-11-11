import { describe, expect, it } from "vitest";
import {
  canonicalFacebookPost,
  postBelongsToDestination,
} from "../../src/lib/facebook-post-url";

describe("Facebook post permalinks", () => {
  it("normalizes mobile, group permalink and story variants to the same post key", () => {
    const urls = [
      "https://m.facebook.com/groups/123/posts/987/?mibextid=x#abc",
      "http://facebook.com/groups/123/permalink/987/",
      "https://web.facebook.com/story.php?story_fbid=987&id=123&tracking=x",
    ];
    expect(urls.map((url) => canonicalFacebookPost(url)?.postKey)).toEqual([
      "post:987",
      "post:987",
      "post:987",
    ]);
    expect(canonicalFacebookPost(urls[0])?.postUrl).toBe(
      "https://www.facebook.com/groups/123/posts/987",
    );
  });
  it.each([
    "https://evil.test/groups/1/posts/2",
    "https://facebook.com.evil.test/a/posts/2",
    "https://user@facebook.com/a/posts/2",
    "https://facebook.com:8443/a/posts/2",
    "https://facebook.com/share/p/test",
    "https://facebook.com/groups/1",
    "https://facebook.com/groups/1/?multi_permalinks=2,3",
    "https://facebook.com/groups/1/?multi_permalinks=2&multi_permalinks=3",
    "https://facebook.com/story.php?story_fbid=2",
    "javascript:alert(1)",
  ])("rejects an unsafe or ambiguous link: %s", (url) => {
    expect(canonicalFacebookPost(url)).toBeNull();
  });
  it("normalizes a single group multi_permalink without guessing between several posts", () => {
    expect(
      canonicalFacebookPost(
        "https://facebook.com/groups/123/?multi_permalinks=987&ref=share",
      ),
    ).toEqual({
      postKey: "post:987",
      postUrl: "https://www.facebook.com/groups/123/posts/987",
    });
  });
  it("requires the exact destination when automatically capturing a link", () => {
    expect(
      postBelongsToDestination(
        "https://facebook.com/groups/123/posts/987",
        "https://facebook.com/groups/123",
      ),
    ).toBe(true);
    expect(
      postBelongsToDestination(
        "https://facebook.com/groups/124/posts/987",
        "https://facebook.com/groups/123",
      ),
    ).toBe(false);
    expect(
      postBelongsToDestination(
        "https://facebook.com/permalink.php?id=123&story_fbid=987",
        "https://facebook.com/profile.php?id=123",
      ),
    ).toBe(true);
  });
});
