import { describe, expect, it } from "vitest";
import { selectRuntime } from "../../src/runtime-selection";
import type { PythonRuntimeInfo } from "../../src/types";

const cpu: PythonRuntimeInfo = {
  pythonExecutable: "cpu/python.exe", baseExecutable: "python.exe",
  torchVersion: "2.11.0+cpu", cudaBuild: null, cudaAvailable: false, deviceName: null,
};
const cuda: PythonRuntimeInfo = {
  pythonExecutable: "cuda/python.exe", baseExecutable: "python.exe",
  torchVersion: "2.11.0+cu128", cudaBuild: "12.8", cudaAvailable: true, deviceName: "GPU",
};

describe("runtime selection", () => {
  it("makes auto prefer a validated CUDA runtime", () => {
    expect(selectRuntime("auto", cpu, cpu, cuda, true)).toEqual({ kind: "selected", runtime: cuda });
  });

  it("reports CPU fallback when auto detects NVIDIA without CUDA runtime", () => {
    const result = selectRuntime("auto", cpu, cpu, null, true);
    expect(result.kind).toBe("cpu-fallback");
  });

  it("requires installation for explicit CUDA", () => {
    expect(selectRuntime("cuda", cpu, cpu, null, true)).toEqual({ kind: "install-cuda" });
    expect(selectRuntime("cuda", cpu, cpu, null, false).kind).toBe("error");
  });

  it("keeps explicit CPU even when CUDA exists", () => {
    expect(selectRuntime("cpu", cuda, cpu, cuda, true)).toEqual({ kind: "selected", runtime: cpu });
  });
});
