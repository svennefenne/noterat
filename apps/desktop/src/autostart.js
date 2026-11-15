// Starting at log-in, in the tray (--hidden). Electron's app.setLoginItemSettings does nothing on Linux:
// there it's a desktop file in ~/.config/autostart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "noterat.desktop");

/**
 * The desktop file that starts `command` (the program and its arguments) hidden. Exec's quoting: each
 * argument in double quotes with " ` $ \ escaped, then the value's own escapes (\ as \\, % as %%).
 */
export function desktopEntry(command) {
  const quote = (arg) => `"${arg.replace(/["`$\\]/g, "\\$&")}"`;
  const exec = [...command, "--hidden"].map(quote).join(" ").replace(/\\/g, "\\\\").replace(/%/g, "%%");
  return ["[Desktop Entry]", "Type=Application", "Name=Noterat", `Exec=${exec}`, "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

export const autostartOn = () => fs.existsSync(autostartFile());

export function setAutostart(on, command) {
  const file = autostartFile();
  if (!on) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, desktopEntry(command));
}
