import { Modal, Notice, Setting } from "obsidian";
import { MAX_MCP_URL_CHARS } from "./constants";
import {
  describeMcpServer,
  validateMcpServerForm,
} from "./mcp-server-form";
import type { McpStatusResponse, McpServerSettings } from "./types";

export interface McpServerEditorOwner {
  app: Modal["app"];
  draftSettings: { mcpServers?: McpServerSettings[] };
  refreshMcpStatus(): Promise<McpStatusResponse>;
}

export interface McpServerEditorCallbacks {
  /** Commit the (already-mutated) working copy into the settings list. */
  onSaved(): void;
  /** A brand-new entry was cancelled: purge env values saved while typing. */
  onCancelledNew?(): void;
  hasEnvValue(name: string): boolean;
  saveEnvValue(name: string, value: string): Promise<void>;
  removeEnvValue(name: string): Promise<void>;
}

/** Smart-Composer-style modal editor (plan §12.3). The settings list stays a
 *  compact roster; every structural field lives here so rows never blend into
 *  unrelated sections below them. */
export class McpServerEditorModal extends Modal {
  private readonly working: McpServerSettings;

  constructor(
    private readonly editorOwner: McpServerEditorOwner,
    working: McpServerSettings,
    private readonly callbacks: McpServerEditorCallbacks,
  ) {
    super(editorOwner.app);
    this.working = working;
  }

  onOpen(): void {
    this.modalEl.addClass("vault-search-mcp-editor");
    this.titleEl.setText("MCP 서버 편집");
    this.renderBasics();
    if (this.working.transport === "stdio") {
      this.renderEnvSection();
    }
    void this.renderToolPolicies();
    this.renderActions();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderBasics(): void {
    const container = this.contentEl.createDiv({
      cls: "vault-search-mcp-editor-basics",
    });
    new Setting(container).setName("표시명").addText((text) =>
      text.setValue(this.working.name).onChange((value) => {
        this.working.name = value;
      }),
    );
    const stdioFields = container.createDiv();
    const httpFields = container.createDiv();

    const applyTransportVisibility = (): void => {
      const isHttp = this.working.transport === "http";
      stdioFields.toggleClass("is-hidden", isHttp);
      httpFields.toggleClass("is-hidden", !isHttp);
    };

    new Setting(container)
      .setName("연결 방식")
      .setDesc(
        "로컬 명령은 이 컴퓨터에서 자식 프로세스로 실행됩니다. 원격 URL은 스트리밍 HTTP MCP 서버에 직접 연결합니다.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("stdio", "로컬 명령 (stdio)")
          .addOption("http", "원격 URL (HTTP)")
          .setValue(this.working.transport)
          .onChange((value) => {
            this.working.transport = value === "http" ? "http" : "stdio";
            applyTransportVisibility();
          }),
      );

    new Setting(stdioFields)
      .setName("실행 명령")
      .setDesc(
        "예: python, npx, C:\\tools\\server.exe — 셸을 거치지 않고 직접 실행됩니다.",
      )
      .addText((text) =>
        text.setValue(this.working.command).onChange((value) => {
          this.working.command = value;
        }),
      );
    new Setting(stdioFields)
      .setName("인자")
      .setDesc("한 줄에 하나씩 입력합니다.")
      .addTextArea((text) => {
        text.setValue(this.working.args.join("\n")).onChange((value) => {
          this.working.args = value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        });
        text.inputEl.rows = 3;
      });
    new Setting(stdioFields)
      .setName("작업 폴더")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vault", "볼트 루트")
          .addOption("plugin", "플러그인 폴더")
          .addOption("custom", "직접 지정")
          .setValue(
            this.working.cwd === "vault" || this.working.cwd === "plugin"
              ? this.working.cwd
              : "custom",
          )
          .onChange((value) => {
            this.working.cwd = value === "custom" ? "" : value;
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("절대 경로 (직접 지정 시)")
          .setValue(
            this.working.cwd !== "vault" && this.working.cwd !== "plugin"
              ? this.working.cwd
              : "",
          )
          .onChange((value) => {
            if (value.trim()) this.working.cwd = value.trim();
          }),
      );

    new Setting(httpFields)
      .setName("서버 URL")
      .setDesc(
        "서비스에서 발급한 전체 URL을 그대로 붙여넣으세요. 토큰이 쿼리 문자열에 포함된 형식이라면 그대로 사용되며 설정 파일에만 저장됩니다(목록에는 호스트까지만 표시).",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://example.com/mcp?token=...")
          .setValue(this.working.url)
          .onChange((value) => {
            this.working.url = value.slice(0, MAX_MCP_URL_CHARS);
          }),
      );
    applyTransportVisibility();
  }

  private renderEnvSection(): void {
    const section = this.contentEl.createDiv({ cls: "vault-search-mcp-env" });
    section.createEl("div", {
      cls: "setting-item-name",
      text: "환경 변수 (값은 보안 저장소에만 저장)",
    });
    const renderRows = (): void => {
      section.querySelectorAll(".vault-search-mcp-env-row").forEach((row) => row.remove());
      for (const envName of [...this.working.envNames]) {
        const row = section.createDiv({ cls: "vault-search-mcp-env-row" });
        row.createEl("span", { text: envName, cls: "vault-search-mcp-env-name" });
        const stored = this.callbacks.hasEnvValue(envName);
        row.createEl("span", {
          text: stored ? "저장됨" : "미저장",
          cls: `vault-search-mcp-env-state ${stored ? "is-set" : "is-unset"}`,
        });
        const input = document.createElement("input");
        input.type = "password";
        input.placeholder = stored ? "•••••••• (변경 시 입력)" : "값 입력";
        input.setAttribute("aria-label", `${envName} 값`);
        input.className = "vault-search-mcp-env-input";
        row.appendChild(input);
        const save = row.createEl("button", {
          text: "저장",
          attr: { type: "button", "aria-label": `${envName} 값 저장` },
        });
        save.addEventListener("click", () => {
          void this.callbacks
            .saveEnvValue(envName, input.value)
            .then(() => {
              input.value = "";
              renderRows();
              new Notice(`${envName} 값을 보안 저장소에 저장했습니다.`, 4000);
            })
            .catch((error: unknown) => {
              new Notice(
                error instanceof Error ? error.message : String(error),
                8000,
              );
            });
        });
        const remove = row.createEl("button", {
          text: "삭제",
          attr: { type: "button", "aria-label": `${envName} 환경 변수 제거` },
        });
        remove.addEventListener("click", () => {
          this.working.envNames = this.working.envNames.filter(
            (name) => name !== envName,
          );
          void this.callbacks.removeEnvValue(envName).catch(() => undefined);
          renderRows();
        });
      }
    };
    renderRows();
    const addRow = section.createDiv({ cls: "vault-search-mcp-env-add" });
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "환경 변수 이름 (예: GITHUB_TOKEN)";
    nameInput.setAttribute("aria-label", "새 환경 변수 이름");
    nameInput.className = "vault-search-mcp-env-input";
    addRow.appendChild(nameInput);
    addRow
      .createEl("button", { text: "변수 추가", attr: { type: "button" } })
      .addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) {
          new Notice("환경 변수 이름 형식이 올바르지 않습니다.", 5000);
          return;
        }
        if (this.working.envNames.includes(name)) {
          new Notice("이미 등록된 이름입니다.", 5000);
          return;
        }
        this.working.envNames = [...this.working.envNames, name];
        nameInput.value = "";
        renderRows();
      });
  }

  private async renderToolPolicies(): Promise<void> {
    try {
      const status = await this.editorOwner.refreshMcpStatus();
      const serverStatus = status.servers.find(
        (entry) => entry.id === this.working.id,
      );
      if (!serverStatus || serverStatus.tools === 0) return;
      const wrap = this.contentEl.createDiv({ cls: "vault-search-mcp-tools" });
      wrap.createEl("div", {
        cls: "setting-item-name",
        text: `발견된 도구 (${serverStatus.tools})`,
      });
      const allTools = Array.from(
        new Set([
          ...Object.keys(this.working.toolPolicies),
          ...(serverStatus.tool_names || []),
        ]),
      ).sort();
      for (const tool of allTools) {
        const row = wrap.createDiv({ cls: "vault-search-mcp-tool-row" });
        row.createEl("span", { text: tool, cls: "vault-search-mcp-tool-name" });
        const select = document.createElement("select");
        select.setAttribute("aria-label", `${tool} 실행 정책`);
        for (const [value, label] of [
          ["deny", "거부 (숨김)"],
          ["ask", "승인 요구"],
          ["allow", "자동 허용"],
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        select.value = this.working.toolPolicies[tool] || "ask";
        select.addEventListener("change", () => {
          this.working.toolPolicies = {
            ...this.working.toolPolicies,
            [tool]: select.value as McpServerSettings["toolPolicies"][string],
          };
        });
        row.appendChild(select);
      }
    } catch {
      // Backend offline: tool policies simply stay untouched.
    }
  }

  private renderActions(): void {
    const bar = this.contentEl.createDiv({
      cls: "vault-search-mcp-editor-actions",
    });
    new Setting(bar)
      .addButton((button) =>
        button.setButtonText("취소").onClick(() => {
          if (!this.isCommittedEntry) this.callbacks.onCancelledNew?.();
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("저장")
          .setCta()
          .onClick(() => {
            const problem = validateMcpServerForm(this.working);
            if (problem) {
              new Notice(problem, 5000);
              return;
            }
            this.callbacks.onSaved();
            this.close();
          }),
      );
  }

  /** True once onSaved ran (or the entry already exists in the list); a
   *  cancel before that means the brand-new entry must be rolled back. */
  private get isCommittedEntry(): boolean {
    return (this.editorOwner.draftSettings.mcpServers || []).some(
      (server) => server.id === this.working.id,
    );
  }
}
