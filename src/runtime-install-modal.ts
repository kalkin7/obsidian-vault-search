import { App, Modal, Setting } from "obsidian";

export class RuntimeInstallModal extends Modal {
  private settled = false;
  constructor(app: App, private readonly explicitCuda: boolean,
    private readonly resolveChoice: (install: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("CUDA 검색 런타임 설치");
    this.contentEl.createEl("p", { text:
      "NVIDIA GPU가 감지됐지만 CUDA용 PyTorch 런타임이 설치되어 있지 않습니다." });
    this.contentEl.createEl("p", { text:
      "최초 설치는 수 GB를 다운로드하므로 네트워크와 PC 성능에 따라 수 분 이상 걸릴 수 있습니다. 설치 후 벡터 인덱스를 다시 구축합니다." });
    if (this.explicitCuda) this.contentEl.createEl("p", { text:
      "CUDA를 명시적으로 선택했으므로 설치하지 않으면 설정을 적용할 수 없습니다." });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("나중에").onClick(() => this.finish(false)))
      .addButton(button => button.setButtonText("설치").setCta().onClick(() => this.finish(true)));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) { this.settled = true; this.resolveChoice(false); }
  }

  private finish(install: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.resolveChoice(install);
  }
}

export function confirmRuntimeInstall(app: App, explicitCuda: boolean): Promise<boolean> {
  return new Promise(resolve => new RuntimeInstallModal(app, explicitCuda, resolve).open());
}
