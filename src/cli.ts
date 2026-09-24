#!/usr/bin/env node
import { parseCliOptions } from "./cli-options.js";
const help = `Usage: nowly-terminal serve [options]

Start a local PTY host for @nowly-lab/terminal browser and React clients.
Set TERMINAL_TOKEN in the environment. Tokens are never printed or put in URLs.

  --port <number>       Listen on 127.0.0.1 (default: 5187, 0: automatic)
  --origin <origin>     Allow this exact browser origin (repeatable)
  --cwd <directory>     Shell working directory (default: current directory)
  --shell <executable>  Shell executable (default: operating-system shell)
  --profile clean|user Skip user startup files or load them (default: user)
  --help               Show this help

Example: nowly-terminal serve --origin http://localhost:3000
Stop with Ctrl+C. The token grants local command execution as this OS user.
`;
try {
  const parsed = parseCliOptions(
    process.argv.slice(2),
    process.env,
    process.cwd(),
  );
  if (parsed.help) {
    console.log(help);
  } else {
    const { createTerminalServer } = await import("./server/index.js");
    const server = await createTerminalServer(parsed.options);
    console.log(`Local terminal server: ${server.url}`);
    let closing = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        if (closing) return;
        closing = true;
        void server.close().then(
          () => {
            process.exitCode = 0;
          },
          (error) => {
            console.error(
              error instanceof Error ? error.message : "Shutdown failed",
            );
            process.exitCode = 1;
          },
        );
      });
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Terminal server failed",
  );
  process.exitCode = 1;
}
