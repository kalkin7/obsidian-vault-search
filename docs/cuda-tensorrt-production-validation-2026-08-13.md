# CUDA / TensorRT 프로덕션 실검증 계획 (2026-08-13)

## 1. 목적

`engine=onnx`(직접 ONNX Runtime) 경로의 **프로덕션 구현**을 NVIDIA GPU 머신에서 실검증합니다.
이 구현(0.1.1)은 저장소에 이미 반영되어 있고, 프로토타입 수준의 CUDA 검증은
`docs/direct-onnx-cuda-validation-plan-2026-08-12.md`(읽기 전용 실험)와 분리됩니다.

**이 문서의 검증은 반드시 NVIDIA GPU가 있는 별도 컴퓨터에서 수행합니다.**
현재 개발 머신에는 NVIDIA GPU가 없어(`nvidia-smi` 부재) 여기서는 실행할 수 없습니다.

## 2. 현재 구현 상태 (0.1.1)

- `engine=pytorch`(기본) | `engine=onnx`(직접 ONNX Runtime, e5-base 전용, CUDA 필수).
- `provider=auto`(기본) | `cuda` | `tensorrt`. `auto`는 TensorRT가 실제로 사용 가능하면
  TensorRT를 우선하고, 사용 불가(CUDA-primary 세션 포함) 시 CUDA EP로 폴백합니다.
- `provider=tensorrt` 명시 시 TensorRT가 없으면 오류를 표시하고 폴백하지 않습니다.
- TRT 엔진은 `dataDir/trt-cache/<key>/`에 캐시됩니다(키: ONNX 경로 + ORT/TRT 버전 + 배치 프로파일, 6GB 상한).
- 메타데이터에 `engine`, `provider`, `effective_provider`가 기록되며, 환경 변화(예: TensorRT 제거)로
  `effective_provider`가 바뀌면 `provider=auto`라도 인덱스가 무효화됩니다.
- 유휴 모델 언로드(`modelIdleTimeoutSeconds`)가 ONNX 엔진에서는 ORT 세션을 해제해 VRAM을 반환합니다.

자세한 동작은 `docs/onnx-tensorrt-engine.md`를 참고합니다.

## 3. 성능 기준 (RTX 5060 Ti, 이미 측정됨)

실측 수치는 `docs/onnx-tensorrt-engine.md`에 기록되어 있습니다(실제 코퍼스 8,420 청크 기준).

| 엔진 | 인덱싱 cps (batch 32) | CUDA FP32 대비 품질 |
|---|---:|---:|
| CUDA FP32 (unfused) | 122 | 기준선 |
| TensorRT FP32 | 413–437 | cosine ≥ 0.99998, recall@40 동일 |
| TensorRT FP16 | ~1,549 | cosine ~0.997 — **이번엔 제외** |

## 4. FP16 제외 결정

**FP16은 이번 단계에서 지원하지 않습니다.** 검증 대상에서 제외하고, 필요하면 나중에
별도로 검토합니다. 그 이유:

- `trt_fp16_enable`은 현재 `False`로 고정되어 있습니다(`direct_onnx.py`).
- 벤치상 성능은 약 3.7배 빠르지만 최소 cosine ~0.997로 FP32 대비 품질 저하가 있어,
  기본값으로 채택하기 전에 별도의 품질 문턱 결정이 필요합니다.
- FP16을 활성화하려면 지속 형식/메타데이터 영향도 재검토가 필요하므로 별도 작업으로 둡니다.

## 5. 실검증 절차 (타머신)

### 5.1 사전 조건

- NVIDIA GPU(예: RTX 5060 Ti)와 최신 드라이버.
- NVIDIA GPU가 검출되는지 확인: `nvidia-smi`.
- Obsidian + 본 플러그인 0.1.1이 설치된 볼트.

### 5.2 런타임 설치

1. 설정 → **CUDA 런타임 설치**를 실행하거나 `setup-backend.ps1 -Runtime cuda`로 설치합니다.
   - `requirements-runtime.txt`의 `onnxruntime-gpu==1.25.1`이 설치됩니다.
   - `requirements-optional-tensorrt.txt`(`tensorrt==10.16.1.11`)는 best-effort로 설치되며,
     실패해도 런타임은 성공으로 처리됩니다(CUDA EP가 대체).
2. 설치 검증(런타임 마커 `.complete.json`)은 다음을 확인합니다:
   - `backend_version == 0.1.1`
   - `deps_hash` 일치(requirements 변경 시 런타임 자동 재생성)
   - `torch.cuda.is_available()` 및 `onnxruntime.get_available_providers()`에
     `CUDAExecutionProvider` 포함.

### 5.3 engine=onnx 설정과 TRT 해석 확인

1. 설정 → **임베딩 엔진** = `ONNX Runtime (CUDA)`로 변경(디바이스는 CUDA로 고정).
2. **ONNX 실행 제공자** = `자동 (TensorRT 우선)`.
3. 설정 적용 → 벡터 재구축이 트리거됩니다.
4. 확인: `index/metadata.json`의 `effective_provider`가 `TensorrtExecutionProvider`인지.
   - TRT 설치 실패로 CUDA로 폴백됐다면 `CUDAExecutionProvider`여야 하며, 그 차이는
     설정이 아니라 실행 환경의 문제로 인덱스에 반영됩니다.

### 5.4 인덱싱 및 성능

1. 벡터 전체 재구축(`rebuild_vectors`) 완료 여부.
2. 인덱싱 속도가 기대 수준(TensorRT ~400cps, CUDA ~120cps)인지 로그/시간으로 확인.
3. `nvidia-smi`로 인코딩 중 GPU utilization > 0 확인(CPU 폴백 없는지).

### 5.5 검색 품질 (PyTorch 대비)

기존 K_Notes gold set(12 쿼리 / 39 기대 파일)으로 다음을 확인합니다:

- `benchmarks/` 하네스로 PyTorch CUDA vs `engine=onnx`의 recall@40 회귀 없음.
- 실검증 여력이 있으면 min cosine ≥ 0.99999(FP32) 수준 파지 확인.

### 5.6 유휴 언로드 (VRAM 반환)

1. `modelIdleTimeoutSeconds`를 예: 60으로 설정, 적용.
2. 검색 후 60초 대기 → 상태가 `idle`로 전환되는지 확인.
3. `nvidia-smi`로 해당 프로세스 VRAM이 해제되는지 확인.
4. 다시 검색 → `MODEL_LOADING` 후 재로드되어 정상 결과 반환하는지 확인.

### 5.7 provider 명시/오류 경로

- `provider=cuda` 명시 → CUDA EP로 동작, 인덱스 재구축.
- `provider=tensorrt` 명시 후 TensorRT가 없는 환경 → 폴백 없이 오류 표시(설정 롤백).
- TRT 캐시: `dataDir/trt-cache/<key>/` 생성 확인, 두 번째 로드 시 ~5초(캐시 히트) 확인.

## 6. 완료 판정

- [ ] 0.1.1 CUDA 런타임 설치 및 검증 통과
- [ ] `engine=onnx` + `provider=auto`에서 `effective_provider`가 TRT로 해석됨
- [ ] 벡터 재구축 성공, GPU utilization 관찰됨
- [ ] PyTorch CUDA 대비 검색 품질 회귀 없음 (recall@40)
- [ ] 유휴 언로드로 VRAM 반환 확인
- [ ] 명시 provider 오류 경로가 설정을 롤백하고 기존 인덱스를 보존
- [ ] FP16은 제외(변경 없음) 상태로 문서에 남김

## 7. 참고

- 구현 문서: `docs/onnx-tensorrt-engine.md`
- 프로토타입 CUDA 실험 계획: `docs/direct-onnx-cuda-validation-plan-2026-08-12.md`
- 런타임 설치: `docs/development.md`, `scripts/setup-backend.ps1`
