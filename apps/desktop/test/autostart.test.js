import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopEntry } from "../src/autostart.js";

const exec = (cmd) => /^Exec=(.*)$/m.exec(desktopEntry(cmd))[1];

test("starts the AppImage hidden", () => {
  assert.equal(exec(["/home/me/Apps/Noterat.AppImage"]), '"/home/me/Apps/Noterat.AppImage" "--hidden"');
  assert.match(desktopEntry(["/x"]), /^\[Desktop Entry\]\nType=Application\nName=Noterat\n/);
});

test("quotes what the desktop file's Exec needs quoted", () => {
  // a space; " ` $ escaped inside the quotes; \ escaped for the quotes and again for the value; % doubled
  assert.equal(exec(["/a b/c"]), '"/a b/c" "--hidden"');
  assert.equal(exec(['/a"b']), '"/a\\\\"b" "--hidden"');
  assert.equal(exec(["/a$b`c"]), '"/a\\\\$b\\\\`c" "--hidden"');
  assert.equal(exec(["/a\\b"]), '"/a\\\\\\\\b" "--hidden"');
  assert.equal(exec(["/100%"]), '"/100%%" "--hidden"');
  assert.equal(exec(["/usr/lib/electron/electron", "/src/apps/desktop"]), '"/usr/lib/electron/electron" "/src/apps/desktop" "--hidden"');
});
