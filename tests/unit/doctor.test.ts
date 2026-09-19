import { describe, it, expect } from "vitest";
import { formatDoctorReport } from "../../src/cli/doctor.js";

describe("formatDoctorReport", () => {
  it("marks passes, problems and informational lines, with aligned labels", () => {
    expect(
      formatDoctorReport([
        { label: "macOS", ok: true, detail: "macOS 27" },
        { label: "On-device model", ok: false, detail: "unavailable" },
        { label: "fm CLI", ok: null, detail: "not found" },
      ]),
    ).toBe(
      [
        "✓ macOS            macOS 27",
        "✗ On-device model  unavailable",
        "· fm CLI           not found",
      ].join("\n"),
    );
  });
});
