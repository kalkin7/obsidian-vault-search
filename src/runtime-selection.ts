import type { DevicePreference, PythonRuntimeInfo } from "./types";

export type RuntimeSelection =
  | { kind: "selected"; runtime: PythonRuntimeInfo }
  | { kind: "install-cuda" }
  | { kind: "cpu-fallback"; runtime: PythonRuntimeInfo; warning: string }
  | { kind: "error"; message: string };

export function selectRuntime(device: DevicePreference, current: PythonRuntimeInfo | null,
  cpu: PythonRuntimeInfo | null, cuda: PythonRuntimeInfo | null,
  hasNvidiaGpu: boolean): RuntimeSelection {
  if (device === "cpu") {
    const selected = cpu || current;
    return selected ? { kind: "selected", runtime: selected }
      : { kind: "error", message: "사용 가능한 CPU 검색 런타임이 없습니다." };
  }
  if (current?.cudaAvailable) return { kind: "selected", runtime: current };
  if (cuda?.cudaAvailable) return { kind: "selected", runtime: cuda };
  if (!hasNvidiaGpu) {
    if (device === "cuda") {
      return { kind: "error", message: "NVIDIA GPU 또는 드라이버를 찾을 수 없습니다." };
    }
    const selected = cpu || current;
    return selected ? { kind: "selected", runtime: selected }
      : { kind: "error", message: "사용 가능한 CPU 검색 런타임이 없습니다." };
  }
  if (device === "cuda") return { kind: "install-cuda" };
  const selected = cpu || current;
  return selected ? {
    kind: "cpu-fallback", runtime: selected,
    warning: "NVIDIA GPU가 감지됐지만 CUDA 런타임이 설치되지 않아 CPU를 사용합니다."
  } : { kind: "install-cuda" };
}
