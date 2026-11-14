// npm run dev: the server (http://localhost:3000, restarts on changes) and the app (http://localhost:5173,
// which passes /api on to the server), side by side in one terminal. Ctrl+C stops both.
import { spawn } from "node:child_process";

const parts = [
  { name: "server", color: 36, args: ["run", "dev", "-w", "@noterat/server"] },
  { name: "app", color: 35, args: ["run", "dev", "-w", "@noterat/app"] },
];

const children = parts.map(({ name, color, args }) => {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = `\x1b[${color}m${name.padEnd(6)}\x1b[0m │ `;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(tag + line + "\n");
    });
  }
  child.on("exit", (code) => {
    process.stdout.write(`${tag}stopped (${code ?? "signal"})\n`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
