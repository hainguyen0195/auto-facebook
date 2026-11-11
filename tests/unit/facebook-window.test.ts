import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn());
vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: launch },
}));
import { FacebookDesktop } from "../../src/desktop/facebook";

function windowFixture(
  state = "minimized",
  url = "https://www.facebook.com/groups/example",
) {
  const send = vi
    .fn()
    .mockResolvedValue({ windowId: 42, bounds: { windowState: state } });
  const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
  const context = {
    pages: vi.fn(),
    newPage: vi.fn(),
    on: vi.fn(),
    newCDPSession: vi.fn().mockResolvedValue(session),
    cookies: vi.fn().mockResolvedValue([{ name: "c_user", value: "12345" }]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    context: () => context,
    isClosed: vi.fn().mockReturnValue(false),
    url: () => url,
    goto: vi.fn().mockResolvedValue(undefined),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
  };
  context.pages.mockReturnValue([page]);
  context.newPage.mockResolvedValue(page);
  launch.mockResolvedValue(context);
  return { page, context, session };
}

describe("Facebook window opening", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("shares an in-flight browser launch for concurrent account opens", async () => {
    const { context } = windowFixture();
    const desktop = new FacebookDesktop(() => "saved-profile");
    const [first, second] = await Promise.all([
      desktop.open("account"),
      desktop.open("account"),
    ]);
    expect(first.context).toBe(context);
    expect(second.context).toBe(context);
    expect(launch).toHaveBeenCalledOnce();
    expect(launch.mock.calls[0][0]).toBe("saved-profile");
  });

  it("can retry after a failed browser launch", async () => {
    windowFixture();
    launch.mockRejectedValueOnce(new Error("profile locked"));
    const desktop = new FacebookDesktop("test-profiles");
    await expect(desktop.open("account")).rejects.toThrow("profile locked");
    await desktop.open("account");
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("does not launch a browser when only checking for an open context", async () => {
    const { page, context } = windowFixture();
    const desktop = new FacebookDesktop("test-profiles");
    expect(desktop.openContext("account")).toBeNull();
    expect(launch).not.toHaveBeenCalled();
    await desktop.open("account");
    expect(desktop.openContext("account")).toBe(context);
    page.isClosed.mockReturnValue(true);
    expect(desktop.openContext("account")).toBeNull();
    expect(context.newPage).not.toHaveBeenCalled();
  });

  it("forgets the closed browser's work tab and reuses the restored tab on explicit reopen", async () => {
    const first = windowFixture();
    const desktop = new FacebookDesktop("test-profiles");
    await desktop.open("account");
    first.context.on.mock.calls.find(([name]) => name === "close")![1]();
    const reopened = windowFixture();
    expect((await desktop.open("account")).page).toBe(reopened.page);
    expect(reopened.context.newPage).not.toHaveBeenCalled();
    expect(reopened.page.bringToFront).not.toHaveBeenCalled();
  });

  it("creates a new work tab when the original closes instead of reusing the inbox tab", async () => {
    const { context, page } = windowFixture();
    const desktop = new FacebookDesktop("test-profiles");
    await desktop.open("account");
    page.isClosed.mockReturnValue(true);
    const observer = { ...page, url: () => "https://www.facebook.com/" };
    const replacement = { ...page, isClosed: () => false };
    context.pages.mockReturnValue([observer]);
    context.newPage.mockResolvedValue(replacement);
    expect((await desktop.open("account")).page).toBe(replacement);
    expect(context.newPage).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight launch before closing the browser", async () => {
    const { context } = windowFixture();
    const desktop = new FacebookDesktop("test-profiles");
    const opening = desktop.open("account");
    await desktop.close();
    await opening;
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("keeps the configured browser when reopening a saved profile", async () => {
    windowFixture();
    vi.stubEnv("NHIPDANG_BROWSER_CHANNEL", "chrome");
    await new FacebookDesktop("test-profiles").open("account");
    expect(launch.mock.calls[0][1]).toMatchObject({
      channel: "chrome",
      headless: false,
      args: ["--restore-last-session"],
    });
  });

  it("restores a minimized window before focusing it and preserves the current page", async () => {
    const { page, session } = windowFixture();
    const desktop = new FacebookDesktop("test-profiles");
    expect(await desktop.show("account")).toMatchObject({ state: "READY" });
    expect(session.send).toHaveBeenCalledWith("Browser.setWindowBounds", {
      windowId: 42,
      bounds: { windowState: "normal" },
    });
    expect(session.send.mock.invocationCallOrder[1]).toBeLessThan(
      page.bringToFront.mock.invocationCallOrder[0],
    );
    expect(page.goto).not.toHaveBeenCalled();
    expect(session.detach).toHaveBeenCalledOnce();
    await desktop.show("account");
    expect(launch).toHaveBeenCalledOnce();
  });

  it.each(["normal", "maximized"])(
    "focuses a %s window without changing its bounds",
    async (state) => {
      const { page, session } = windowFixture(state);
      await new FacebookDesktop("test-profiles").show("account");
      expect(session.send).toHaveBeenCalledTimes(1);
      expect(page.bringToFront).toHaveBeenCalledOnce();
    },
  );

  it("opens Facebook when the browser starts with a blank tab", async () => {
    const { page } = windowFixture("normal", "about:blank");
    await new FacebookDesktop("test-profiles").show("account");
    expect(page.goto).toHaveBeenCalledWith("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
    });
  });

  it("creates a page in an existing context with no tabs", async () => {
    const { context } = windowFixture();
    context.pages.mockReturnValue([]);
    await new FacebookDesktop("test-profiles").show("account");
    expect(context.newPage).toHaveBeenCalledOnce();
  });

  it("keeps checkpoint and login-required states when showing the window", async () => {
    const { context } = windowFixture(
      "normal",
      "https://www.facebook.com/checkpoint",
    );
    expect(
      await new FacebookDesktop("test-profiles").show("account"),
    ).toMatchObject({ state: "CHALLENGE" });
    windowFixture("normal", "https://www.facebook.com/login");
    context.cookies.mockResolvedValue([]);
    expect(
      await new FacebookDesktop("test-profiles").show("account"),
    ).toMatchObject({ state: "LOGIN_REQUIRED" });
  });

  it("reports restoration errors and releases the CDP session", async () => {
    const { page, session } = windowFixture();
    session.send.mockRejectedValueOnce(new Error("window closed"));
    await expect(
      new FacebookDesktop("test-profiles").show("account"),
    ).rejects.toThrow("window closed");
    expect(session.detach).toHaveBeenCalledOnce();
    expect(page.bringToFront).not.toHaveBeenCalled();
  });

  it("does not focus or restore windows during background session checks", async () => {
    const { page, context } = windowFixture();
    await new FacebookDesktop("test-profiles").check("account");
    expect(page.goto).toHaveBeenCalledWith("https://www.facebook.com/me", {
      waitUntil: "domcontentloaded",
    });
    expect(context.newCDPSession).not.toHaveBeenCalled();
    expect(page.bringToFront).not.toHaveBeenCalled();
  });
});
