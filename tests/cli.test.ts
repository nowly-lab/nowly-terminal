import { expect, test } from "vitest";
import { parseCliOptions } from "../src/cli-options.js";
test("serve uses explicit authentication, loopback, initialized user shell and cwd", () => {
  expect(
    parseCliOptions(
      [
        "serve",
        "--origin",
        "http://localhost:3000",
        "--port",
        "9090",
        "--cwd",
        "/tmp/project",
      ],
      { TERMINAL_TOKEN: "test-only" },
      "/fallback",
    ),
  ).toEqual({
    help: false,
    options: {
      token: "test-only",
      port: 9090,
      allowedOrigins: ["http://localhost:3000"],
      hostOptions: { cwd: "/tmp/project", shellProfile: "user" },
    },
  });
});
test("help does not require a secret and invalid options fail before starting", () => {
  expect(parseCliOptions(["--help"], {}, "/tmp")).toEqual({ help: true });
  expect(() => parseCliOptions(["serve"], {}, "/tmp")).toThrow(
    "TERMINAL_TOKEN",
  );
  for (const args of [
    ["serve", "--port", "-1"],
    ["serve", "--port", "NaN"],
    ["serve", "--port", "65536"],
    ["serve", "--origin", "*"],
    ["serve", "--profile", "other"],
    ["serve", "--wat"],
    ["serve", "--cwd"],
  ])
    expect(() =>
      parseCliOptions(args, { TERMINAL_TOKEN: "test-only" }, "/tmp"),
    ).toThrow();
});
test("user shell mode and repeated origins remain configurable", () => {
  const parsed = parseCliOptions(
    [
      "serve",
      "--profile",
      "user",
      "--shell",
      "/bin/zsh",
      "--origin",
      "http://localhost:3000",
      "--origin",
      "null",
    ],
    { TERMINAL_TOKEN: "test-only" },
    "/tmp",
  );
  expect(parsed).toMatchObject({
    help: false,
    options: {
      allowedOrigins: ["http://localhost:3000", "null"],
      hostOptions: { shell: "/bin/zsh", shellProfile: "user" },
    },
  });
});
