import { describe, it, expect, vi } from "vitest";

import { beginReportedRun } from "../ipc/active-run.js";
import { FormatCancelled } from "../ollama.js";

const fakeEvent = (send) => ({ sender: { send } });

describe("beginReportedRun", () => {
  it("report forwards stage/detail to the renderer", () => {
    const send = vi.fn();
    const { report } = beginReportedRun(fakeEvent(send));

    report("Formatting…", "part 1");

    expect(send).toHaveBeenCalledWith("llm:format-progress", {
      stage: "Formatting…",
      detail: "part 1",
    });
  });

  it("report defaults detail to an empty string", () => {
    const send = vi.fn();
    const { report } = beginReportedRun(fakeEvent(send));

    report("Preparing…");

    expect(send).toHaveBeenCalledWith("llm:format-progress", {
      stage: "Preparing…",
      detail: "",
    });
  });

  it("report swallows a send that throws (window gone)", () => {
    const send = vi.fn(() => {
      throw new Error("window destroyed");
    });
    const { report } = beginReportedRun(fakeEvent(send));

    expect(() => report("Writing…")).not.toThrow();
  });

  it("ensureLive is a no-op while the run is live", () => {
    const { ensureLive } = beginReportedRun(fakeEvent(vi.fn()));
    expect(() => ensureLive()).not.toThrow();
  });

  it("ensureLive throws FormatCancelled once the token is cancelled", () => {
    const { token, ensureLive } = beginReportedRun(fakeEvent(vi.fn()));
    token.cancelled = true;
    expect(() => ensureLive()).toThrow(FormatCancelled);
  });
});
