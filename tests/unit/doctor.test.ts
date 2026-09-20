import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { formatDoctorReport, collectDoctorReport, main } from "../../src/cli/doctor.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

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

describe("collectDoctorReport", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });
  });

  it("gathers system checks for the host machine", async () => {
    const report = await collectDoctorReport();
    expect(Array.isArray(report)).toBe(true);
    expect(report.length).toBeGreaterThanOrEqual(5);

    const labels = report.map((c) => c.label);
    expect(labels).toContain("tsfm");
    expect(labels).toContain("Node.js");
    expect(labels).toContain("macOS");
    expect(labels).toContain("fm CLI");

    const tsfmCheck = report.find((c) => c.label === "tsfm")!;
    expect(tsfmCheck.detail).not.toBe("unknown");
    expect(tsfmCheck.ok).toBeNull();

    const nodeCheck = report.find((c) => c.label === "Node.js")!;
    expect(nodeCheck.detail).toContain(process.version);
    expect(nodeCheck.ok).toBeNull();

    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("Node.js");
    expect(formatted).toContain(process.version);
  });

  it("handles fm CLI errors gracefully when spawning fails", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: Object.assign(new Error("not found"), { code: "ENOENT" }),
      status: null,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const report = await collectDoctorReport();
    const fmCheck = report.find((c) => c.label === "fm CLI")!;
    expect(fmCheck.detail).toContain("not needed by tsfm");
  });

  it("handles fm CLI unlicensed exit code 69", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 69,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const report = await collectDoctorReport();
    const fmCheck = report.find((c) => c.label === "fm CLI")!;
    expect(fmCheck.detail).toContain("license not agreed");
  });

  it("handles fm CLI agreed license exit code 0", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const report = await collectDoctorReport();
    const fmCheck = report.find((c) => c.label === "fm CLI")!;
    expect(fmCheck.detail).toBe("installed, license agreed");
  });

  it("handles other fm CLI spawn errors", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: Object.assign(new Error("EACCES"), { code: "EACCES" }),
      status: null,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const report = await collectDoctorReport();
    const fmCheck = report.find((c) => c.label === "fm CLI")!;
    expect(fmCheck.detail).toContain("EACCES");
  });

  it("handles unknown exit status codes from fm CLI", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 12,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const report = await collectDoctorReport();
    const fmCheck = report.find((c) => c.label === "fm CLI")!;
    expect(fmCheck.detail).toContain("exit 12");
  });
});

describe("main", () => {
  it("runs default doctor command and writes to stdout", async () => {
    const origArgv = [...process.argv];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      process.argv = ["node", "tsfm", "doctor"];
      await main();
      expect(stdoutWrite).toHaveBeenCalled();
    } finally {
      process.argv = origArgv;
      stdoutWrite.mockRestore();
    }
  });

  it("handles unknown command and sets exitCode to 64", async () => {
    const origArgv = [...process.argv];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      process.argv = ["node", "tsfm", "invalid"];
      await main();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("Unknown command: invalid"));
      expect(process.exitCode).toBe(64);
    } finally {
      process.argv = origArgv;
      stderrWrite.mockRestore();
      process.exitCode = undefined;
    }
  });
});
