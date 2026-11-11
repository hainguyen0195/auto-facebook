export const macAgentLabel = "com.nhipdang.desktop";
export const macAppId = "com.nhipdang.desktop.launcher";

export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function macLaunchAgent(appRoot: string, release: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${macAgentLabel}</string>
<key>ProgramArguments</key><array><string>${xml(release + "/node")}</string><string>${xml(release + "/background.mjs")}</string></array>
<key>WorkingDirectory</key><string>${xml(appRoot)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ProcessType</key><string>Interactive</string>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>60</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(appRoot + "/data/background.log")}</string>
<key>StandardErrorPath</key><string>${xml(appRoot + "/data/background.error.log")}</string>
</dict></plist>
`;
}

export function macStartCommand(plist: string) {
  return `#!/bin/bash
set -eu
domain="gui/$(/usr/bin/id -u)"
if ! /bin/launchctl print "$domain/${macAgentLabel}" >/dev/null 2>&1; then
  /bin/launchctl bootstrap "$domain" ${shellQuote(plist)}
fi
/bin/launchctl kickstart "$domain/${macAgentLabel}"
`;
}

export function macUninstallCommand(release: string) {
  return `#!/bin/bash
set -eu
${shellQuote(release + "/node")} ${shellQuote(release + "/macos-setup.mjs")} --uninstall
if [ -t 0 ]; then read -r -p "Press Return to close..."; fi
`;
}

export const macAppletSource = `on startRunner()
  set homePath to POSIX path of (path to home folder)
  do shell script quoted form of (homePath & "Library/Application Support/NhipDang/Start.command")
end startRunner
on run
  my startRunner()
end run
on open location requestedURL
  my startRunner()
end open location
`;
