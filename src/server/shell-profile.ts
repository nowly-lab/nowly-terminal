export type ShellProfile = "user" | "clean";
export function shellProfileArgs(
  shell: string,
  profile: ShellProfile,
): string[] {
  const name = shell
    .split(/[\\/]/)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "");
  if (profile === "user") {
    if (["zsh", "bash", "fish", "sh", "dash"].includes(name ?? ""))
      return ["-il"];
    if (name === "pwsh" || name === "powershell") return ["-NoLogo"];
    return [];
  }
  switch (name) {
    case "zsh":
      return ["-f"];
    case "bash":
      return ["--noprofile", "--norc"];
    case "fish":
      return ["--no-config"];
    case "pwsh":
    case "powershell":
      return ["-NoLogo", "-NoProfile"];
    case "cmd":
      return ["/d"];
    case "sh":
    case "dash":
      return [];
    default:
      throw new Error(
        `Clean profile is unsupported for ${shell}; supply explicit args or use shellProfile: 'user'`,
      );
  }
}
