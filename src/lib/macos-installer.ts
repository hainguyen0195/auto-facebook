import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { AppError } from "./errors";
import { shellQuote } from "../desktop/macos-installation";

const target = (arch: "arm64" | "x64") =>
  z.object({
    bundle: z
      .string()
      .regex(new RegExp(`^desktop-macos-${arch}-[a-f0-9]{16}\\.zip$`)),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  });
const releaseSchema = z.object({ arm64: target("arm64"), x64: target("x64") });
export type MacRelease = z.infer<typeof releaseSchema>;
const releasePath = () => path.resolve("public/downloads/desktop-macos.json");
export const macosInstallerAvailable = () => existsSync(releasePath());
export async function macosRelease(): Promise<MacRelease> {
  try {
    return releaseSchema.parse(
      JSON.parse(await readFile(releasePath(), "utf8")),
    );
  } catch {
    throw new AppError(
      503,
      "Bộ cài MacBook chưa sẵn sàng. Vui lòng liên hệ quản trị viên.",
    );
  }
}

export function renderMacInstaller(input: {
  server: string;
  code: string;
  workspaceId: string;
  release: MacRelease;
}) {
  const server = new URL(input.server);
  if (
    server.username ||
    server.password ||
    (server.protocol !== "https:" &&
      !(
        server.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(server.hostname)
      ))
  )
    throw new Error("Invalid installation server");
  z.string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(input.code);
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .parse(input.workspaceId);
  const release = releaseSchema.parse(input.release);
  return `#!/bin/bash
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
stage=""
cleanup() {
  if [ -n "$stage" ]; then
    case "$stage" in "$app_root"/.install.*) rm -rf -- "$stage" ;; esac
  fi
}
trap cleanup EXIT
fail() { echo "$1" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail "Bo cai nay danh cho macOS."
version=$(sw_vers -productVersion)
major="\${version%%.*}"
case "$major" in ''|*[!0-9]*) fail "Khong doc duoc phien ban macOS." ;; esac
[ "$major" -ge 14 ] || fail "Can macOS 14 tro len. Hay cap nhat macOS truoc khi cai."
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  arch=arm64
else
  case "$(uname -m)" in arm64) arch=arm64 ;; x86_64) arch=x64 ;; *) fail "Chip Mac chua duoc ho tro." ;; esac
fi
server=${shellQuote(server.origin)}
workspace=${shellQuote(input.workspaceId)}
code=${shellQuote(input.code)}
app_root="$HOME/Library/Application Support/NhipDang"
mkdir -p "$app_root"
if [ -f "$app_root/data/connection.json" ]; then
  saved_server=$(plutil -extract server raw -o - "$app_root/data/connection.json")
  saved_workspace=$(plutil -extract workspaceId raw -o - "$app_root/data/connection.json")
  [ "$saved_server" = "$server" ] && [ "$saved_workspace" = "$workspace" ] || fail "Mac nay da cai cho tai khoan web khac. Hay dung dung tai khoan de cap nhat."
fi
case "$arch" in
  arm64) bundle='${release.arm64.bundle}'; expected='${release.arm64.sha256}' ;;
  x64) bundle='${release.x64.bundle}'; expected='${release.x64.sha256}' ;;
esac
echo "Dang tai Nhip Dang cho Mac ($arch). Ban chi can cai mot lan..."
stage=$(mktemp -d "$app_root/.install.XXXXXX")
curl --proto '${server.protocol === "https:" ? "=https" : "=http,https"}' --proto-redir '${server.protocol === "https:" ? "=https" : "=http,https"}' --fail --location --retry 2 --connect-timeout 15 --max-time 300 "$server/downloads/$bundle" -o "$stage/release.zip"
actual=$(shasum -a 256 "$stage/release.zip")
actual="\${actual%% *}"
[ "$actual" = "$expected" ] || fail "Bo cai tai ve khong toan ven. Hay tai lai tu website."
ditto -x -k "$stage/release.zip" "$stage/release"
release="$app_root/\${expected:0:16}"
if [ ! -d "$release" ]; then mv "$stage/release" "$release"; fi
chmod 700 "$release/node"
"$release/node" "$release/macos-setup.mjs" --server "$server" --code "$code" --workspace "$workspace"
if [ -t 0 ]; then read -r -p "Nhan Return de dong..."; fi
`;
}

export async function macInstallerArchive(
  input: Parameters<typeof renderMacInstaller>[0],
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: 6,
  });
  await writer.add(
    "Cai-Nhip-Dang.command",
    new Uint8ArrayReader(Buffer.from(renderMacInstaller(input))),
    { unixMode: 0o100755 },
  );
  await writer.add(
    "HUONG-DAN.txt",
    new Uint8ArrayReader(
      Buffer.from(
        "NHIP DANG - MACBOOK\n\n" +
          "1. Giai nen ZIP va mo Cai-Nhip-Dang.command tren Mac (macOS 14+).\n" +
          "2. Bo cai tu chon Apple Silicon/Intel, cai runtime va trinh duyet. Khong can cai Node.js hoac database.\n" +
          "3. Mo web > May dang & Facebook, chon Mac va bam Dung may nay. Dang nhap Facebook lan dau tren Mac.\n" +
          "Nhung lan sau ung dung tu chay khi dang nhap macOS. Co the mo Applications > Nhip Dang hoac bam Ket noi lai tren web.\n" +
          "Mac can bat, khong ngu va co mang. File cai dat chi dung mot lan trong 15 phut; giu kin file nay.\n" +
          "Cap nhat ung dung: cai bo moi, sau do dang xuat/dang nhap macOS.\n" +
          "Go cai dat: mo Applications > Go Nhip Dang.command. Phien Facebook van duoc giu tren Mac.\n" +
          "Neu macOS chan file tai ve, kiem tra dung website cua ban va dung lua chon Mo cua macOS neu duoc cho phep; khong tat Gatekeeper.\n",
      ),
    ),
    { unixMode: 0o100644 },
  );
  return writer.close();
}
