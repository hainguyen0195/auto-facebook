import { describe, expect, it } from "vitest";
import {
  linksFromPublicationResponse,
  matchesPublicationRequest,
} from "../../src/desktop/published-link";

const expected = {
  destination: "https://www.facebook.com/groups/123",
  content: "Selected text",
  actorId: "456",
};
const url = "https://www.facebook.com/groups/123/posts/987";
function request(
  input = {
    actor_id: "456",
    message: { text: "Selected text" },
    audience: { to_id: "123" },
  },
  name = "ComposerStoryCreateMutation",
) {
  return new URLSearchParams({
    fb_api_req_friendly_name: name,
    variables: JSON.stringify({ input }),
  }).toString();
}
function response(story: unknown, extra: object = {}) {
  return JSON.stringify({ data: { story_create: { story } }, ...extra });
}
describe("evidence from a single authorized publication", () => {
  it("requires a creation request with the same actor, content and destination", () => {
    expect(matchesPublicationRequest(request(), expected)).toBe(true);
    for (const changed of [
      {
        actor_id: "789",
        message: { text: "Selected text" },
        audience: { to_id: "123" },
      },
      {
        actor_id: "456",
        message: { text: "Other text" },
        audience: { to_id: "123" },
      },
      {
        actor_id: "456",
        message: { text: "Selected text" },
        audience: { to_id: "789" },
      },
    ])
      expect(matchesPublicationRequest(request(changed), expected)).toBe(false);
    expect(
      matchesPublicationRequest(
        request(undefined, "CometUFICreateCommentMutation"),
        expected,
      ),
    ).toBe(false);
    expect(
      matchesPublicationRequest(
        request(undefined, "ComposerStoryUpdateMutation"),
        expected,
      ),
    ).toBe(false);
    expect(matchesPublicationRequest("not-json", expected)).toBe(false);
  });
  it("reads only the created story, ignoring shared and suggested posts", () => {
    expect(
      linksFromPublicationResponse(
        response({
          url,
          actors: [{ id: "456" }],
          attached_story: { url: url.replace("987", "888") },
        }),
        expected,
      ),
    ).toEqual([url]);
    expect(
      linksFromPublicationResponse(
        response({ attached_story: { url } }),
        expected,
      ),
    ).toEqual([]);
    expect(
      linksFromPublicationResponse(
        JSON.stringify({ data: { viewer: { feed: { story: { url } } } } }),
        expected,
      ),
    ).toEqual([]);
  });
  it("rejects mismatching destinations, actors, partial errors and opaque IDs", () => {
    for (const story of [
      { url: url.replace("123", "124") },
      { url, actors: [{ id: "wrong" }] },
      { id: "opaque-id" },
      { post_id: "opaque-id" },
    ])
      expect(linksFromPublicationResponse(response(story), expected)).toEqual(
        [],
      );
    expect(
      linksFromPublicationResponse(
        response({ url }, { errors: [{ message: "failed" }] }),
        expected,
      ),
    ).toEqual([]);
  });
  it("supports numeric IDs explicitly returned by the creation response", () => {
    expect(
      linksFromPublicationResponse(response({ legacy_fbid: "987" }), expected),
    ).toEqual([url]);
    expect(
      linksFromPublicationResponse(response({ post_id: "987" }), expected),
    ).toEqual([url]);
  });
  it("handles guarded and newline-delimited JSON, without scanning arbitrary strings", () => {
    const valid = response({ url });
    expect(linksFromPublicationResponse(`for (;;);${valid}`, expected)).toEqual(
      [url],
    );
    expect(
      linksFromPublicationResponse(`${valid}\n${valid}`, expected),
    ).toEqual([url]);
    expect(
      linksFromPublicationResponse(`error message with ${url}`, expected),
    ).toEqual([]);
    expect(
      linksFromPublicationResponse("x".repeat(2 * 1024 * 1024 + 1), expected),
    ).toEqual([]);
  });
});
