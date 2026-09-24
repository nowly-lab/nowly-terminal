import type { ServerOptions } from "./server/websocket.js";
export type CliOptions =
  { help: true } | { help: false; options: ServerOptions };
export function parseCliOptions(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): CliOptions {
  if (!args.length || args[0] === "--help" || args[0] === "-h")
    return { help: true };
  if (args[0] !== "serve")
    throw new Error("Expected: nowly-terminal serve. Use --help for usage.");
  if (args.includes("--help")) return { help: true };
  const options: ServerOptions = {
    token: env.TERMINAL_TOKEN ?? "",
    port: 5187,
    allowedOrigins: [],
    hostOptions: { cwd, shellProfile: "user" },
  };
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${key}`);
    switch (key) {
      case "--port": {
        const port = Number(value);
        if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535)
          throw new Error("Port must be an integer from 0 to 65535");
        options.port = port;
        break;
      }
      case "--origin": {
        if (value !== "null") {
          let url: URL;
          try {
            url = new URL(value);
          } catch {
            throw new Error("Origin must be an exact http(s) origin");
          }
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.origin !== value
          )
            throw new Error("Origin must be an exact http(s) origin");
        }
        options.allowedOrigins.push(value);
        break;
      }
      case "--cwd":
        options.hostOptions!.cwd = value;
        break;
      case "--shell":
        options.hostOptions!.shell = value;
        break;
      case "--profile":
        if (value !== "clean" && value !== "user")
          throw new Error("Profile must be clean or user");
        options.hostOptions!.shellProfile = value;
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }
  if (!options.token.trim())
    throw new Error(
      "Set TERMINAL_TOKEN to a nonempty secret before starting the server",
    );
  return { help: false, options };
}
