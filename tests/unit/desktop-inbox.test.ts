import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FacebookDesktop } from "../../src/desktop/facebook";
import { FacebookInboxReader } from "../../src/desktop/inbox";
import {
  confirmReadStates,
  readInboxList,
} from "../../src/inbox-trial/browser";

vi.mock("../../src/inbox-trial/browser", () => ({
  checkIdentity: vi.fn(async () => null),
  confirmReadStates: vi.fn(async (_page, snapshot) => snapshot),
  readInboxList: vi.fn(async () => ({
    recognized: true,
    unsafe: false,
    pinRequired: false,
    rows: [{ id: "thread", name: "Customer", preview: "Hello", unread: true }],
  })),
  openMessengerPanel: vi.fn(async () => false),
}));

function fixture() {
  const page = {
    isClosed: vi.fn(() => false),
    context: () => context,
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    bringToFront: vi.fn(),
  };
  const context = { newPage: vi.fn(async () => page) };
  const facebook = { openContext: vi.fn(() => context), open: vi.fn() };
  const reader = new FacebookInboxReader(
    facebook as unknown as FacebookDesktop,
  );
  return { page, context, facebook, reader };
}

describe("inbox browser lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays stopped when Chrome was closed instead of launching or opening a work tab", async () => {
    const { facebook, context, reader } = fixture();
    facebook.openContext.mockReturnValue(null as never);
    for (let i = 0; i < 3; i++)
      expect(await reader.read("account", "identity")).toEqual({
        status: "STOPPED",
        conversations: [],
      });
    expect(facebook.open).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
  });

  it("reuses one inbox tab without creating or focusing a posting tab", async () => {
    const { facebook, page, context, reader } = fixture();
    expect((await reader.read("account", "identity")).status).toBe("ONLINE");
    expect((await reader.read("account", "identity")).status).toBe("ONLINE");
    expect(context.newPage).toHaveBeenCalledOnce();
    expect(page.goto).toHaveBeenCalledOnce();
    expect(page.bringToFront).not.toHaveBeenCalled();
    expect(facebook.open).not.toHaveBeenCalled();
    await reader.releaseExcept(new Set());
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("reconciles the server's previously unread conversations before reporting", async () => {
    const { reader, page } = fixture();
    await reader.read("account", "identity", undefined, ["thread"]);
    expect(confirmReadStates).not.toHaveBeenCalled();
    await reader.read("account", "identity", undefined, ["thread"]);
    expect(confirmReadStates).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ recognized: true }),
      ["thread"],
    );
  });

  it("keeps the user's opened conversation and recovers monitoring in a separate tab", async () => {
    const { reader, page, context } = fixture();
    await reader.read("account", "identity");
    vi.mocked(readInboxList).mockResolvedValueOnce({
      recognized: true,
      unsafe: true,
      pinRequired: false,
      rows: [],
    });
    expect((await reader.read("account", "identity")).status).toBe(
      "UNSAFE_VIEW",
    );
    expect(page.close).not.toHaveBeenCalled();
    const monitoringPage = { ...page, close: vi.fn(async () => {}) };
    context.newPage.mockResolvedValueOnce(monitoringPage);
    expect((await reader.read("account", "identity")).status).toBe("ONLINE");
    expect(context.newPage).toHaveBeenCalledTimes(2);
    await reader.releaseExcept(new Set());
    expect(monitoringPage.close).toHaveBeenCalledOnce();
    expect(page.close).not.toHaveBeenCalled();
  });

  it("closes the newly created tab if pause arrives during its creation", async () => {
    const { page, context, reader } = fixture();
    const controller = new AbortController();
    context.newPage.mockImplementation(async () => {
      controller.abort();
      return page;
    });
    expect(
      (await reader.read("account", "identity", controller.signal)).status,
    ).toBe("OFFLINE");
    expect(page.close).toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("removes its new monitor tab if Facebook restores an open chat in it", async () => {
    const { reader, page, context } = fixture();
    vi.mocked(readInboxList).mockResolvedValueOnce({
      recognized: false,
      unsafe: true,
      pinRequired: false,
      rows: [],
    });
    expect((await reader.read("account", "identity")).status).toBe(
      "UNSAFE_VIEW",
    );
    expect(page.close).toHaveBeenCalledOnce();
    expect((await reader.read("account", "identity")).status).toBe("ONLINE");
    expect(context.newPage).toHaveBeenCalledTimes(2);
  });

  it("cleans up failed navigation rather than leaving blank tabs", async () => {
    const { page, reader, facebook } = fixture();
    page.goto.mockRejectedValue(new Error("network failure"));
    expect((await reader.read("account", "identity")).status).toBe("OFFLINE");
    expect(page.close).toHaveBeenCalledOnce();
    expect(facebook.open).not.toHaveBeenCalled();
  });
});
