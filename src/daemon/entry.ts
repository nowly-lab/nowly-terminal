// Import the native host only inside the detached process, after bootstrap.
const bootstrapTimeout = setTimeout(() => process.exit(1), 15000);
process.once("message", async (message: unknown) => {
  clearTimeout(bootstrapTimeout);
  try {
    const { runtimeDir, hostOptions } = message as {
      runtimeDir: string;
      hostOptions: import("../server/host.js").HostOptions;
    };
    if (
      typeof runtimeDir !== "string" ||
      !hostOptions ||
      typeof hostOptions !== "object"
    )
      throw Error("Invalid daemon bootstrap");
    const { startDaemon } = await import("./server.js");
    const daemon = await startDaemon(runtimeDir, hostOptions);
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(
        signal,
        () => void daemon.stop().then(() => process.exit(0)),
      );
    process.send?.(
      { type: "ready", instanceId: daemon.descriptor.instanceId },
      () => process.disconnect?.(),
    );
  } catch (error) {
    process.send?.(
      {
        type: "error",
        message:
          error instanceof Error ? error.message : "Daemon startup failed",
      },
      () => process.exit(1),
    );
    if (!process.connected) process.exit(1);
  }
});
