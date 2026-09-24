import type { Terminal } from "@xterm/headless";
/** Public parser observers retain designations that xterm's serializer omits. */
export class CharsetState {
  private sets = ["B", "B", "B", "B"];
  private listeners: Array<{ dispose(): void }> = [];
  constructor(private terminal: Terminal) {
    for (const [slot, intermediates] of ["(", ")", "*", "+"].entries()) {
      for (const final of [
        "0",
        "A",
        "B",
        "4",
        "C",
        "5",
        "R",
        "Q",
        "K",
        "Y",
        "E",
        "6",
        "Z",
        "H",
        "7",
        "=",
      ]) {
        this.listeners.push(
          terminal.parser.registerEscHandler({ intermediates, final }, () => {
            this.sets[slot] = final;
            return false;
          }),
        );
      }
    }
    const reset = () => {
      this.sets = ["B", "B", "B", "B"];
      return false;
    };
    this.listeners.push(
      terminal.parser.registerEscHandler({ final: "c" }, reset),
      terminal.parser.registerCsiHandler(
        { intermediates: "!", final: "p" },
        reset,
      ),
    );
    for (const final of ["G", "@"])
      this.listeners.push(
        terminal.parser.registerEscHandler(
          { intermediates: "%", final },
          () => {
            this.sets[0] = "B";
            return false;
          },
        ),
      );
  }
  serialize() {
    // Pinned xterm versions expose locking shift only through the internal charset service.
    const core = this.terminal as unknown as {
      _core?: { _charsetService?: { glevel?: number } };
    };
    const level = core._core?._charsetService?.glevel ?? 0;
    return (
      this.sets
        .map((set, index) => `\x1b${["(", ")", "*", "+"][index]}${set}`)
        .join("") + (["\x0f", "\x0e", "\x1bn", "\x1bo"][level] ?? "\x0f")
    );
  }
  dispose() {
    for (const listener of this.listeners) listener.dispose();
  }
}
