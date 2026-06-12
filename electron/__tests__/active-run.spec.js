import { describe, it, expect, vi } from "vitest";

import {
  beginReportedRun,
  beginRun,
  cancelActiveRun,
  endRun,
} from "../ipc/active-run.js";
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

describe("run token lifecycle", () => {
  it("cancelActiveRun flags the run in flight; a finished run cannot be flagged", () => {
    const finished = beginRun();
    endRun(finished);
    cancelActiveRun();
    expect(finished.cancelled).toBe(false);

    const live = beginRun();
    cancelActiveRun();
    expect(live.cancelled).toBe(true);
    endRun(live);
  });

  it("a stale endRun does not clear a newer run", () => {
    const oldRun = beginRun();
    const newRun = beginRun(); // replaces oldRun as the active token
    endRun(oldRun); // stale — must not detach newRun

    cancelActiveRun();

    expect(newRun.cancelled).toBe(true);
    expect(oldRun.cancelled).toBe(false);
    endRun(newRun);
  });
});
