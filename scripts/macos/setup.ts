import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  macAgentLabel,
  macAppId,
  macAppletSource,
  macLaunchAgent,
  macStartCommand,
  macUninstallCommand,
} from "../../src/desktop/macos-installation";

const release = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(homedir(), "Library/Application Support/NhipDang");
const dataRoot = path.join(appRoot, "data");
const plist = path.join(
  homedir(),
  "Library/LaunchAgents",
  macAgentLabel + ".plist",
);
const app = path.join(homedir(), "Applications/Nhip Dang.app");
const uninstall = path.join(homedir(), "Applications/Go Nhip Dang.command");
const domain = `gui/${process.getuid?.()}`;
process.umask(0o077);

async function run(
  file: string,
  args: string[],
  visible = false,
  env = process.env,
) {
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const child = spawn(file, args, {
      env,
      stdio: visible ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (b) => {
      output += b;
    });
    child.stderr?.on("data", (b) => {
      output += b;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              `${path.basename(file)} failed (${code}). ${output.trim()}`,
            ),
          ),
    );
  });
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );
async function ownsApp() {
  if (!(await exists(app))) return false;
  const id = await run("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    path.join(app, "Contents/Info.plist"),
  ]);
  if (id !== macAppId)
    throw new Error(
      "Applications/Nhip Dang.app belongs to another application.",
    );
  return true;
}

async function install() {
  const args = process.argv.slice(2);
  const option = (key: string) => {
    const index = args.indexOf("--" + key);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing --${key}`);
    return args[index + 1];
  };
  const server = new URL(option("server"));
  const code = option("code");
  const workspaceId = option("workspace");
  if (
    server.username ||
    server.password ||
    (server.protocol !== "https:" &&
      !(
        server.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(server.hostname)
      )) ||
    !/^[A-Za-z0-9_-]{43}$/.test(code) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(workspaceId)
  )
    throw new Error(
      "Invalid installation information. Download a new installer from the website.",
    );
  if (
    path.dirname(release) !== appRoot ||
    !/^[a-f0-9]{16}$/.test(path.basename(release))
  )
    throw new Error("Unexpected release location.");
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const configPath = path.join(dataRoot, "connection.json");
  let saved: {
    server: string;
    workspaceId: string;
    deviceId: string;
    token: string;
  } | null = null;
  if (await exists(configPath)) {
    saved = JSON.parse(await readFile(configPath, "utf8"));
    if (
      !saved ||
      saved.server !== server.origin ||
      saved.workspaceId !== workspaceId
    )
      throw new Error(
        "This Mac is installed for another web account. Use that account to update it.",
      );
    const response = await fetch(server.origin + "/api/desktop/status", {
      headers: { Authorization: `Bearer ${saved.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) saved = null;
    else {
      if (!response.ok)
        throw new Error(
          "Cannot verify the existing connection. Check the network and try again.",
        );
      const status = await response.json();
      if (status.id !== saved.deviceId || status.workspaceId !== workspaceId)
        throw new Error("Existing device identity mismatch.");
    }
  }
  await ownsApp();
  if (await exists(plist)) {
    const label = await run("/usr/bin/plutil", [
      "-extract",
      "Label",
      "raw",
      "-o",
      "-",
      plist,
    ]);
    if (label !== macAgentLabel)
      throw new Error("Unexpected LaunchAgent; nothing overwritten.");
  }
  const env = {
    ...process.env,
    NHIPDANG_DESKTOP_DIR: dataRoot,
    PLAYWRIGHT_BROWSERS_PATH: path.join(appRoot, "browsers"),
    DOTENV_CONFIG_PATH: path.join(appRoot, "unused.env"),
  };
  console.log("Dang cai trinh duyet Facebook. Co the mat vai phut...");
  await run(
    process.execPath,
    [
      path.join(release, "node_modules/playwright/cli.js"),
      "install",
      "chromium",
    ],
    true,
    env,
  );
  if (!saved) {
    console.log("Dang ket noi voi website...");
    await run(
      process.execPath,
      [
        path.join(release, "desktop.mjs"),
        "--server",
        server.origin,
        "--code",
        code,
        "--name",
        `${await run("/bin/hostname", ["-s"])} (Mac)`,
        "--pair-only",
      ],
      true,
      env,
    );
    const paired = JSON.parse(await readFile(configPath, "utf8"));
    if (paired.workspaceId !== workspaceId || paired.server !== server.origin)
      throw new Error("Paired workspace mismatch.");
  }
  await mkdir(path.dirname(plist), { recursive: true });
  await mkdir(path.dirname(app), { recursive: true });
  const loaded = await run("/bin/launchctl", [
    "print",
    `${domain}/${macAgentLabel}`,
  ]).then(
    () => true,
    () => false,
  );
  const stage = await mkdtemp(path.join(appRoot, ".app-"));
  try {
    const source = path.join(stage, "launcher.applescript");
    const stagedApp = path.join(stage, "Nhip Dang.app");
    await writeFile(source, macAppletSource);
    await run("/usr/bin/osacompile", ["-o", stagedApp, source]);
    const info = path.join(stagedApp, "Contents/Info.plist");
    const metadata = JSON.parse(
      await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", info]),
    );
    metadata.CFBundleIdentifier = macAppId;
    metadata.CFBundleDisplayName = "Nhịp Đăng";
    metadata.LSUIElement = true;
    metadata.CFBundleURLTypes = [
      { CFBundleURLName: "Nhịp Đăng", CFBundleURLSchemes: ["nhipdang"] },
    ];
    await writeFile(info, JSON.stringify(metadata));
    await run("/usr/bin/plutil", ["-convert", "xml1", info]);
    await run("/usr/bin/codesign", ["--force", "--sign", "-", stagedApp]);
    await cp(stagedApp, app, { recursive: true });
    await writeFile(
      path.join(appRoot, "Start.command"),
      macStartCommand(plist),
      { mode: 0o700 },
    );
    await writeFile(uninstall, macUninstallCommand(release), { mode: 0o700 });
    await writeFile(plist, macLaunchAgent(appRoot, release), { mode: 0o600 });
    await run("/usr/bin/plutil", ["-lint", plist]);
    await run(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", app],
    );
    await unlink(path.join(dataRoot, "background.stop")).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      },
    );
    if (!loaded) await run("/bin/launchctl", ["bootstrap", domain, plist]);
    console.log(
      loaded
        ? "Da cap nhat. Dang xuat va dang nhap macOS de dung ban moi; cong viec dang chay duoc giu nguyen."
        : "Da cai xong. Ung dung tu chay khi dang nhap macOS. Mo website de chon Mac va bam Dung may nay.",
    );
    console.log(
      "Mo Nhip Dang trong Applications hoac bam Ket noi lai tren web. Mac can bat, khong ngu va co mang.",
    );
    await run("/usr/bin/open", [server.origin + "/desktop"]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function remove() {
  await ownsApp();
  if (await exists(plist)) {
    const label = await run("/usr/bin/plutil", [
      "-extract",
      "Label",
      "raw",
      "-o",
      "-",
      plist,
    ]);
    if (label !== macAgentLabel)
      throw new Error("Unexpected LaunchAgent; nothing removed.");
  }
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dataRoot, "background.stop"), "stop");
  await run("/bin/launchctl", ["bootout", `${domain}/${macAgentLabel}`]).catch(
    async (error) => {
      if (
        await run("/bin/launchctl", [
          "print",
          `${domain}/${macAgentLabel}`,
        ]).then(
          () => true,
          () => false,
        )
      )
        throw error;
    },
  );
  await unlink(plist).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  if (await exists(app)) {
    await run(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-u", app],
    );
    await rm(app, { recursive: true });
  }
  await unlink(uninstall).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
  console.log(
    "Da go tu khoi dong va ung dung. Phien Facebook van duoc giu tai: " +
      dataRoot,
  );
}

if (process.platform !== "darwin")
  throw new Error("This installer is for macOS only.");
try {
  if (process.argv.includes("--uninstall")) await remove();
  else await install();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Installation failed.",
  );
  process.exitCode = 1;
}
