export type ShellProfile = "user" | "clean";
export function shellProfileArgs(
  shell: string,
  profile: ShellProfile,
): string[] {
  if (profile === "user") return [];
  const name = shell
    .split(/[\\/]/)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "");
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
