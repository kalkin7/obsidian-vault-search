import { Modal, Notice, Setting } from "obsidian";
import { MAX_MCP_URL_CHARS } from "./constants";
import {
  isLoopbackHost,
  toSafeOrigin,
  validateMcpServerForm,
  withPolicyForAll,
} from "./mcp-server-form";
import { sanitizeSecretMessage } from "./mcp-transaction-coordinator";
import type { McpStatusResponse, McpServerSettings } from "./types";

export interface McpServerEditorOwner {
  app: Modal["app"];
  draftSettings: { mcpServers?: McpServerSettings[] };
  refreshMcpStatus(): Promise<McpStatusResponse>;
}

export interface StagedSecrets {
  envValues: Record<string, string>;
  removedEnvNames: string[];
  httpUrl?: string | null;
}

export interface McpServerEditorCallbacks {
  hasEnvValue(name: string): boolean;
  hasHttpUrl?(): boolean;
  /** Transactional save boundary: commits staged secrets + settings together.
   *  Must throw if verification or write fails. */
  onSave?(working: McpServerSettings, staged: StagedSecrets): Promise<void>;
  /** Optional notification when new server modal is cancelled/closed without saving */
  onCancelledNew?(): void;
  /** Legacy callbacks retained for backward-compatible testing */
  onSaved?(): void;
  saveAllSecrets?(staged: StagedSecrets): Promise<void>;
  saveEnvValue?(name: string, value: string): Promise<void>;
  removeEnvValue?(name: string): Promise<void>;
  saveHttpUrl?(url: string): Promise<void>;
  removeHttpUrl?(): Promise<void>;
}

/** Smart-Composer-style modal editor (plan §12.3). The settings list stays a
 *  compact roster; every structural field lives here so rows never blend into
 *  unrelated sections below them. */
export class McpServerEditorModal extends Modal {
  private readonly working: McpServerSettings;
  private readonly originalSafeOrigin: string;
  private readonly stagedEnvValues = new Map<string, string | null>();
  private stagedHttpUrl: string | null | undefined = undefined;
  private isSaving = false;
  private isSaved = false;
  private allowCloseAfterSave = false;
  private cancelledNewCalled = false;
  private envSectionEl: HTMLElement | null = null;
  private applyVisibility: (() => void) | null = null;

  constructor(
    private readonly editorOwner: McpServerEditorOwner,
    working: McpServerSettings,
    private readonly callbacks: McpServerEditorCallbacks,
  ) {
    super(editorOwner.app);
    this.working = working;
    this.originalSafeOrigin = toSafeOrigin(working.url || "");
  }

  override close(): void {
    if (this.isSaving && !this.allowCloseAfterSave) {
      // Block all close paths while saving (Escape, X button, backdrop click, etc.)
      return;
    }
    super.close();
  }

  onOpen(): void {
    this.modalEl.addClass("vault-search-mcp-editor");
    this.titleEl.setText("MCP 서버 편집");
    this.renderBasics();
    this.renderEnvSection();
    const toolsContainer = this.contentEl.createDiv({
      cls: "vault-search-mcp-tools",
    });
    this.renderActions();
    this.applyVisibility?.();
    void this.populateToolPolicies(toolsContainer);
  }


  private hasStoredOrStagedUrl(): boolean {
    if (this.stagedHttpUrl !== undefined) {
      return this.stagedHttpUrl !== null && this.stagedHttpUrl !== "";
    }
    if (this.callbacks.hasHttpUrl) {
      return this.callbacks.hasHttpUrl();
    }
    return Boolean(this.working.url);
  }

  private hasStoredOrStagedEnv(name: string): boolean {
    if (this.stagedEnvValues.has(name)) {
      const v = this.stagedEnvValues.get(name);
      return v !== null && v !== "";
    }
    return this.callbacks.hasEnvValue(name);
  }

  private renderBasics(): void {
    const container = this.contentEl.createDiv({
      cls: "vault-search-mcp-editor-basics",
    });
    // Field order matters (user feedback v0.1.60): the transport selector must
    // sit DIRECTLY below the display name because it swaps everything below
    // it. Append it to the container BEFORE creating the field wrappers.
    new Setting(container).setName("표시명").addText((text) =>
      text.setValue(this.working.name).onChange((value) => {
        this.working.name = value;
      }),
    );

    const applyTransportVisibility = (): void => {
      const isHttp = this.working.transport === "http";
      stdioFields.toggleClass("is-hidden", isHttp);
      httpFields.toggleClass("is-hidden", !isHttp);
      if (this.envSectionEl) {
        this.envSectionEl.toggleClass("is-hidden", isHttp);
      }
      // The custom-path input belongs to the "직접 지정" mode only.
      const isCustom =
        this.working.cwd !== "vault" && this.working.cwd !== "plugin";
      cwdCustomField.toggleClass("is-hidden", !isCustom);
    };
    this.applyVisibility = applyTransportVisibility;

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

    const stdioFields = container.createDiv();
    const httpFields = container.createDiv();

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
    const cwdSetting = new Setting(stdioFields).setName("작업 폴더");
    const cwdCustomField = stdioFields.createDiv();
    cwdSetting.addDropdown((dropdown) =>
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
          if (value === "custom") {
            // Keep any previously typed absolute path; only clear the
            // sentinel when arriving here from a preset folder.
            if (
              this.working.cwd === "vault" ||
              this.working.cwd === "plugin"
            ) {
              this.working.cwd = "";
            }
          } else {
            this.working.cwd = value;
          }
          applyTransportVisibility();
        }),
    );
    new Setting(cwdCustomField)
      .setName("작업 폴더 경로")
      .setDesc("직접 지정 시 사용할 절대 경로입니다.")
      .addText((text) =>
        text
          .setPlaceholder("예: C:\\tools\\mcp-server")
          .setValue(
            this.working.cwd !== "vault" && this.working.cwd !== "plugin"
              ? this.working.cwd
              : "",
          )
          .onChange((value) => {
            if (value.trim()) this.working.cwd = value.trim();
          }),
      );

    const httpSetting = new Setting(httpFields)
      .setName("서버 URL")
      .setDesc(
        "서비스에서 발급한 전체 접속 URL을 입력하세요. 전체 URL은 Obsidian 보안 저장소에만 보관되며, 설정 파일과 상태 목록에는 도메인(오리진)만 표시됩니다.",
      );

    const httpWarningEl = httpFields.createDiv({
      cls: "vault-search-mcp-http-warning is-hidden",
    });
    httpWarningEl.setText(
      "경고: 비-루프백 HTTP 연결은 암호화되지 않습니다. 원격 서버는 HTTPS를 권장합니다.",
    );

    let urlInputEl: HTMLInputElement | null = null;

    const renderHttpField = (): void => {
      const stored = this.hasStoredOrStagedUrl();
      const originDisplay = this.working.url
        ? ` (표시 오리진: ${toSafeOrigin(this.working.url)})`
        : "";
      httpSetting.setDesc(
        `전체 URL은 보안 저장소에만 보관됩니다. 현재 상태: ${stored ? "저장됨" : "미저장"}${originDisplay}`,
      );
      try {
        const checkUrl = this.stagedHttpUrl || this.working.url;
        if (checkUrl) {
          const parsed = new URL(checkUrl);
          if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
            httpWarningEl.removeClass("is-hidden");
          } else {
            httpWarningEl.addClass("is-hidden");
          }
        } else {
          httpWarningEl.addClass("is-hidden");
        }
      } catch {
        httpWarningEl.addClass("is-hidden");
      }
    };

    httpSetting.addText((text) => {
      urlInputEl = text.inputEl;
      if (text.inputEl) {
        text.inputEl.type = "password";
        if (typeof text.inputEl.setAttribute === "function") {
          text.inputEl.setAttribute("aria-label", "원격 MCP 서버 전체 URL");
        }
      }
      const stored = this.hasStoredOrStagedUrl();
      text
        .setPlaceholder(
          stored
            ? "•••••••• (변경 시 새 전체 URL 입력)"
            : "https://example.com/mcp?token=...",
        )
        .onChange((value) => {
          const trimmed = value.trim();
          if (trimmed) {
            this.stagedHttpUrl = trimmed;
            const safe = toSafeOrigin(trimmed);
            this.working.url = safe;
          } else {
            this.stagedHttpUrl = undefined;
            this.working.url = this.originalSafeOrigin;
          }
          renderHttpField();
        });
    });

    httpSetting.addButton((button) =>
      button
        .setButtonText("URL 삭제")
        .setWarning()
        .onClick(() => {
          this.stagedHttpUrl = "";
          this.working.url = "";
          if (urlInputEl) urlInputEl.value = "";
          renderHttpField();
          new Notice("원격 URL이 삭제 대기 상태로 설정되었습니다. '저장' 시 완전히 삭제됩니다.", 4000);
        }),
    );

    renderHttpField();
    applyTransportVisibility();
  }

  private renderEnvSection(): void {
    const section = this.contentEl.createDiv({ cls: "vault-search-mcp-env" });
    this.envSectionEl = section;
    section.createEl("div", {
      cls: "setting-item-name",
      text: "환경 변수 (값은 보안 저장소에만 저장)",
    });
    const renderRows = (): void => {
      section
        .querySelectorAll(".vault-search-mcp-env-row")
        .forEach((row) => row.remove());
      for (const envName of [...this.working.envNames]) {
        const row = section.createDiv({ cls: "vault-search-mcp-env-row" });
        row.createEl("span", {
          text: envName,
          cls: "vault-search-mcp-env-name",
        });
        const stored = this.hasStoredOrStagedEnv(envName);
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
          text: "입력",
          attr: { type: "button", "aria-label": `${envName} 값 입력` },
        });
        save.addEventListener("click", () => {
          const val = input.value;
          this.stagedEnvValues.set(envName, val);
          input.value = "";
          renderRows();
          new Notice(
            `${envName} 값이 준비되었습니다. 모달의 '저장' 버튼을 누르면 보안 저장소에 반영됩니다.`,
            4000,
          );
        });
        const remove = row.createEl("button", {
          text: "삭제",
          attr: { type: "button", "aria-label": `${envName} 환경 변수 제거` },
        });
        remove.addEventListener("click", () => {
          this.working.envNames = this.working.envNames.filter(
            (name) => name !== envName,
          );
          this.stagedEnvValues.set(envName, null);
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

  private async populateToolPolicies(wrap: HTMLElement): Promise<void> {
    try {
      const status = await this.editorOwner.refreshMcpStatus();
      const serverStatus = status.servers.find(
        (entry) => entry.id === this.working.id,
      );
      if (!serverStatus || serverStatus.tools === 0) return;
      wrap.empty();
      wrap.createEl("div", {
        cls: "setting-item-name",
        text: `발견된 도구 (${serverStatus.tools}) — 실행 전 승인 여부`,
      });
      const allTools = Array.from(
        new Set([
          ...Object.keys(this.working.toolPolicies),
          ...(serverStatus.tool_names || []),
        ]),
      ).sort();

      // Claude-style segmented ✓/✋/⊘ toggles instead of per-tool dropdowns:
      // policy decisions belong in settings, not in repeated approval cards.
      const renderSegmented = (
        parent: HTMLElement,
        tools: string[],
        current: string,
      ): void => {
        const seg = parent.createDiv({ cls: "vault-search-policy-seg" });
        for (const [value, label, icon] of [
          ["allow", "자동 허용", "✓"],
          ["ask", "승인 요구", "✋"],
          ["deny", "거부", "⊘"],
        ] as const) {
          const button = seg.createEl("button", {
            text: `${icon} ${label}`,
            cls: `vault-search-policy-option seg-${value}${
              current === value ? " is-active" : ""
            }`,
            attr: {
              type: "button",
              "aria-label": `${tools.length > 1 ? `${tools.length}개 도구` : tools[0]} ${label}`,
              "aria-pressed": String(current === value),
            },
          });
          button.addEventListener("click", () => {
            this.working.toolPolicies =
              tools.length === 1
                ? { ...this.working.toolPolicies, [tools[0]]: value }
                : withPolicyForAll(this.working.toolPolicies, tools, value);
            renderRows();
          });
        }
      };

      const renderRows = (): void => {
        wrap
          .querySelectorAll(
            ".vault-search-mcp-tool-row,.vault-search-mcp-tools-all",
          )
          .forEach((row) => row.remove());
        const allRow = wrap.createDiv({ cls: "vault-search-mcp-tools-all" });
        allRow.createEl("span", {
          text: "모든 도구",
          cls: "vault-search-mcp-tool-name",
        });
        renderSegmented(allRow, allTools, this.majorityPolicy(allTools));
        for (const tool of allTools) {
          const row = wrap.createDiv({ cls: "vault-search-mcp-tool-row" });
          row.createEl("span", {
            text: tool,
            cls: "vault-search-mcp-tool-name",
          });
          renderSegmented(
            row,
            [tool],
            this.working.toolPolicies[tool] || "ask",
          );
        }
      };
      renderRows();
    } catch {
      // Backend offline: tool policies simply stay untouched.
    }
  }

  /** The policy shown on the bulk row: the common value across tools, or
   *  "ask" when they disagree (safe default wins ties). */
  private majorityPolicy(tools: string[]): string {
    let allow = true;
    let deny = true;
    for (const tool of tools) {
      const policy = this.working.toolPolicies[tool] || "ask";
      if (policy !== "allow") allow = false;
      if (policy !== "deny") deny = false;
    }
    if (allow) return "allow";
    if (deny) return "deny";
    return "ask";
  }

  onClose(): void {
    if (!this.isSaved && !this.isCommittedEntry && !this.cancelledNewCalled) {
      this.cancelledNewCalled = true;
      this.callbacks.onCancelledNew?.();
    }
    this.contentEl.empty();
  }

  private renderActions(): void {
    const bar = this.contentEl.createDiv({
      cls: "vault-search-mcp-editor-actions",
    });
    let saveButton: any = null;
    let cancelButton: any = null;

    new Setting(bar)
      .addButton((button) => {
        cancelButton = button;
        button.setButtonText("취소").onClick(() => {
          if (this.isSaving) return;
          this.close();
        });
      })
      .addButton((button) => {
        saveButton = button;
        button
          .setButtonText("저장")
          .setCta()
          .onClick(async () => {
            if (this.isSaving) return;
            const problem = validateMcpServerForm(this.working, {
              hasStoredUrl: this.hasStoredOrStagedUrl(),
              stagedRawUrl: this.stagedHttpUrl,
            });
            if (problem) {
              new Notice(problem, 5000);
              return;
            }
            this.isSaving = true;
            this.allowCloseAfterSave = false;

            const formElements = Array.from(
              this.modalEl.querySelectorAll<
                HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement
              >("input, textarea, select, button"),
            );
            const previousDisabledStates = formElements.map((el) => el.disabled);
            formElements.forEach((el) => {
              el.disabled = true;
            });

            try {
              const workingSnapshot: McpServerSettings = {
                ...this.working,
                args: [...this.working.args],
                envNames: [...this.working.envNames],
                toolPolicies: { ...this.working.toolPolicies },
              };
              const envValues: Record<string, string> = {};
              const removedEnvNames: string[] = [];
              for (const [name, val] of this.stagedEnvValues.entries()) {
                if (val === null || val === "") removedEnvNames.push(name);
                else envValues[name] = val;
              }
              const stagedSnapshot: StagedSecrets = {
                envValues,
                removedEnvNames,
                httpUrl: this.stagedHttpUrl,
              };
              if (this.callbacks.onSave) {
                await this.callbacks.onSave(workingSnapshot, stagedSnapshot);
              } else {
                await this.commitStagedSecrets();
                this.callbacks.onSaved?.();
              }
              this.allowCloseAfterSave = true;
              this.isSaved = true;
              this.close();
            } catch (error) {
              this.isSaving = false;
              this.allowCloseAfterSave = false;
              formElements.forEach((el, idx) => {
                el.disabled = previousDisabledStates[idx] ?? false;
              });
              const rawMsg =
                error instanceof Error ? error.message : String(error);
              const envVals = Array.from(this.stagedEnvValues.values()).filter(
                (v): v is string => Boolean(v),
              );
              const sanitized = sanitizeSecretMessage(rawMsg, [
                this.stagedHttpUrl,
                ...envVals,
              ]);
              new Notice(sanitized, 8000);
            }
          });
      });
  }

  private async commitStagedSecrets(): Promise<void> {
    try {
      if (this.callbacks.saveAllSecrets) {
        const envValues: Record<string, string> = {};
        const removedEnvNames: string[] = [];
        for (const [name, val] of this.stagedEnvValues.entries()) {
          if (val === null || val === "") removedEnvNames.push(name);
          else envValues[name] = val;
        }
        await this.callbacks.saveAllSecrets({
          envValues,
          removedEnvNames,
          httpUrl: this.stagedHttpUrl,
        });
        return;
      }

      if (this.stagedHttpUrl !== undefined) {
        if (this.stagedHttpUrl === null || this.stagedHttpUrl === "") {
          if (this.callbacks.removeHttpUrl) {
            await this.callbacks.removeHttpUrl();
          }
        } else {
          if (this.callbacks.saveHttpUrl) {
            await this.callbacks.saveHttpUrl(this.stagedHttpUrl);
          }
        }
      }
      for (const [name, val] of this.stagedEnvValues.entries()) {
        if (val === null || val === "") {
          if (this.callbacks.removeEnvValue) {
            await this.callbacks.removeEnvValue(name);
          }
        } else {
          if (this.callbacks.saveEnvValue) {
            await this.callbacks.saveEnvValue(name, val);
          }
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.startsWith("MCP_SECRET_COMMIT_FAILED:") ||
          err.message.startsWith("MCP_SECRET_DELETE_FAILED:") ||
          err.message.startsWith("MCP_SECRET_SNAPSHOT_FAILED:") ||
          err.message.startsWith("MCP_SECRET_RESTORE_FAILED:") ||
          err.message.startsWith("MCP_TRANSACTION_FAILED:"))
      ) {
        throw err;
      }
      throw new Error(
        `MCP_SECRET_COMMIT_FAILED: 서버(${this.working.id}) 보안 저장소 반영에 실패했습니다.`,
      );
    }
  }

  /** True once onSaved ran (or the entry already exists in the list); a
   *  cancel before that means the brand-new entry must be rolled back. */
  private get isCommittedEntry(): boolean {
    return (this.editorOwner.draftSettings.mcpServers || []).some(
      (server) => server.id === this.working.id,
    );
  }
}
