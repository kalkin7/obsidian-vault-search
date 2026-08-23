import { Notice, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import {
  MAX_MCP_ARGS,
  MAX_MCP_ARG_CHARS,
  MAX_MCP_SERVERS,
} from "./constants";
import type { McpServerSettings, McpStatusResponse } from "./types";

const STATE_LABELS: Record<string, string> = {
  disabled: "비활성",
  awaiting_secret: "환경 변수 대기",
  connecting: "연결 중",
  connected: "연결됨",
  error: "오류",
};

function validateServer(server: McpServerSettings): string | null {
  if (!server.name.trim()) return "표시명을 입력해 주세요.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(server.name.trim()))
    return "표시명은 영문/숫자/공백/._- 64자 이내여야 합니다.";
  if (!server.command.trim()) return "실행 명령을 입력해 주세요.";
  if (server.args.length > MAX_MCP_ARGS)
    return `인자는 최대 ${MAX_MCP_ARGS}개까지 가능합니다.`;
  if (server.args.some((arg) => arg.length > MAX_MCP_ARG_CHARS))
    return `각 인자는 최대 ${MAX_MCP_ARG_CHARS}자입니다.`;
  if (
    server.cwd !== "vault" &&
    server.cwd !== "plugin" &&
    !/^[A-Za-z]:[\\/]/.test(server.cwd) &&
    !server.cwd.startsWith("/")
  )
    return "사용자 지정 작업 폴더는 절대 경로여야 합니다.";
  return null;
}

/** MCP servers section (plan §12.3). Form-based editing only — no raw JSON
 *  textarea, since quoting mistakes and plaintext secrets are too easy. */
export function renderMcpSettings(
  containerEl: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
): void {
  containerEl.createEl("h3", { text: "MCP 서버" });

  new Setting(containerEl)
    .setName("로컬 MCP 서버 사용")
    .setDesc(
      "Desktop 전용. stdio 방식의 로컬 MCP 서버를 등록하면 API 모델이 해당 도구를 발견하고 호출합니다. 새 도구는 기본적으로 실행 전 승인을 요구합니다.",
    )
    .addToggle((toggle) =>
      toggle.setValue(draft.mcpEnabled).onChange((value) => {
        draft.mcpEnabled = value;
      }),
    );

  const statusBox = containerEl.createDiv({
    cls: "vault-search-mcp-status",
    text: "상태를 확인하는 중…",
  });
  void owner.refreshMcpStatus().then((status) => {
    renderStatusLine(statusBox, status);
  }).catch(() => {
    statusBox.setText("백엔드가 실행 중이 아닙니다. 시작 후 상태가 표시됩니다.");
  });

  const list = containerEl.createDiv({ cls: "vault-search-mcp-list" });
  for (const server of draft.mcpServers || []) {
    renderServerEditor(list, owner, draft, server, () => {
      // Re-render just this section after structural edits.
      owner.settingTab?.display();
    });
  }

  new Setting(containerEl)
    .setName("서버 추가")
    .setDesc(`최대 ${MAX_MCP_SERVERS}개까지 등록할 수 있습니다.`)
    .addButton((button) =>
      button.setButtonText("추가").onClick(() => {
        if ((draft.mcpServers || []).length >= MAX_MCP_SERVERS) {
          new Notice(`MCP 서버는 최대 ${MAX_MCP_SERVERS}개입니다.`, 5000);
          return;
        }
        owner.addMcpServer();
        owner.settingTab?.display();
      }),
    );
}

function renderStatusLine(
  box: HTMLElement,
  status: McpStatusResponse,
): void {
  box.empty();
  const problems = status.config_problems || [];
  const lines: string[] = [];
  for (const server of status.servers) {
    const label = STATE_LABELS[server.state] || server.state;
    lines.push(
      `${server.name}: ${label}${server.message ? ` (${server.message})` : ""} · 도구 ${server.tools}개`,
    );
  }
  if (!lines.length) lines.push("등록된 서버가 없습니다.");
  if (problems.length) lines.push(`설정 경고: ${problems.join(" / ")}`);
  const surface = status.tool_surface;
  if (surface?.tools_truncated) {
    lines.push(
      `도구 수 제한: 발견 ${surface.discovered_tools}개 중 ${surface.exposed_mcp_tools}개만 모델에 노출됩니다 (최대 100개).`,
    );
  }
  if (surface?.schema_truncated) {
    lines.push("스키마 크기 제한: 일부 도구 정의가 요청 한도를 초과해 제외되었습니다.");
  }
  box.setText(lines.join("\n"));
}

function renderServerEditor(
  container: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
  server: McpServerSettings,
  onChanged: () => void,
): void {
  const details = container.createEl("details", {
    cls: "vault-search-mcp-server",
  });
  const summary = details.createEl("summary");
  summary.setText(`${server.name || "(이름 없음)"} — ${server.command || "명령 미지정"}`);

  new Setting(details)
    .setName("사용")
    .addToggle((toggle) =>
      toggle.setValue(server.enabled).onChange((value) => {
        server.enabled = value;
      }),
    );
  new Setting(details)
    .setName("표시명")
    .addText((text) =>
      text.setValue(server.name).onChange((value) => {
        server.name = value;
        summary.setText(`${value || "(이름 없음)"} — ${server.command || "명령 미지정"}`);
      }),
    );
  new Setting(details)
    .setName("실행 명령")
    .setDesc("예: python, npx, C:\\tools\\server.exe — 셸을 거치지 않고 직접 실행됩니다.")
    .addText((text) =>
      text.setValue(server.command).onChange((value) => {
        server.command = value;
      }),
    );
  new Setting(details)
    .setName("인자")
    .setDesc("한 줄에 하나씩 입력합니다.")
    .addTextArea((text) => {
      text.setValue(server.args.join("\n")).onChange((value) => {
        server.args = value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      });
      text.inputEl.rows = 3;
    });
  new Setting(details)
    .setName("작업 폴더")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("vault", "볼트 루트")
        .addOption("plugin", "플러그인 폴더")
        .addOption("custom", "직접 지정")
        .setValue(
          server.cwd === "vault" || server.cwd === "plugin" ? server.cwd : "custom",
        )
        .onChange((value) => {
          server.cwd =
            value === "custom" ? "" : value;
        }),
    )
    .addText((text) => {
      text
        .setPlaceholder("절대 경로 (직접 지정 시)")
        .setValue(server.cwd !== "vault" && server.cwd !== "plugin" ? server.cwd : "")
        .onChange((value) => {
          if (value.trim()) server.cwd = value.trim();
        });
    });

  renderEnvRows(details, owner, server);

  const toolsSetting = new Setting(details)
    .setName("도구별 정책")
    .setDesc("연결 후 발견된 도구의 실행 정책입니다. 새 도구는 기본 'ask'입니다.")
    .addButton((button) =>
      button.setButtonText("상태 새로고침").onClick(async () => {
        try {
          const status = await owner.refreshMcpTools();
          renderToolPolicies(toolsSetting.settingEl, server, status);
          new Notice("MCP 도구 목록을 갱신했습니다.", 4000);
        } catch (error) {
          new Notice(
            error instanceof Error ? error.message : String(error),
            8000,
          );
        }
      }),
    );
  void owner.refreshMcpStatus().then((status) => {
    renderToolPolicies(toolsSetting.settingEl, server, status);
  }).catch(() => undefined);

  new Setting(details)
    .setName("서버 삭제")
    .setDesc("저장된 환경 변수 값도 함께 삭제됩니다.")
    .addButton((button) =>
      button
        .setButtonText("삭제")
        .setWarning()
        .onClick(async () => {
          if (!window.confirm(`MCP 서버 '${server.name}'을(를) 삭제할까요?`))
            return;
          await owner.deleteMcpServer(server.id);
          onChanged();
        }),
    );

  details.addEventListener("toggle", () => {
    if (!details.open) return;
    const problem = validateServer(server);
    if (problem) new Notice(problem, 5000);
  });
}

function renderEnvRows(
  container: HTMLElement,
  owner: VaultSearchPlugin,
  server: McpServerSettings,
): void {
  const wrap = container.createDiv({ cls: "vault-search-mcp-env" });
  wrap.createEl("div", {
    cls: "setting-item-name",
    text: "환경 변수 (값은 보안 저장소에만 저장)",
  });
  for (const envName of [...server.envNames]) {
    const row = wrap.createDiv({ cls: "vault-search-mcp-env-row" });
    row.createEl("span", { text: envName, cls: "vault-search-mcp-env-name" });
    const stored = owner.hasMcpEnvValue(server.id, envName);
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
    save.addEventListener("click", async () => {
      try {
        await owner.saveMcpEnvValue(server.id, envName, input.value);
        input.value = "";
        new Notice(`${envName} 값을 보안 저장소에 저장했습니다.`, 4000);
        owner.settingTab?.display();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      }
    });
    const remove = row.createEl("button", {
      text: "삭제",
      attr: { type: "button", "aria-label": `${envName} 환경 변수 제거` },
    });
    remove.addEventListener("click", () => {
      server.envNames = server.envNames.filter((name) => name !== envName);
      // Purge the stored value and drop it from the sidecar snapshot too.
      void owner.removeMcpEnvValue(server.id, envName);
      owner.settingTab?.display();
    });
  }
  const addRow = wrap.createDiv({ cls: "vault-search-mcp-env-add" });
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "환경 변수 이름 (예: GITHUB_TOKEN)";
  nameInput.setAttribute("aria-label", "새 환경 변수 이름");
  nameInput.className = "vault-search-mcp-env-input";
  addRow.appendChild(nameInput);
  addRow.createEl("button", { text: "변수 추가", attr: { type: "button" } })
    .addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) {
        new Notice("환경 변수 이름 형식이 올바르지 않습니다.", 5000);
        return;
      }
      if (server.envNames.includes(name)) {
        new Notice("이미 등록된 이름입니다.", 5000);
        return;
      }
      server.envNames = [...server.envNames, name];
      owner.settingTab?.display();
    });
}

function renderToolPolicies(
  container: HTMLElement,
  server: McpServerSettings,
  status: McpStatusResponse,
): void {
  const existing = container.querySelector(".vault-search-mcp-tools");
  existing?.remove();
  const serverStatus = status.servers.find((entry) => entry.id === server.id);
  if (!serverStatus || serverStatus.tools === 0) return;
  const wrap = container.createDiv({ cls: "vault-search-mcp-tools" });
  wrap.createEl("div", {
    cls: "setting-item-name",
    text: `발견된 도구 (${serverStatus.tools})`,
  });
  const allTools = Array.from(
    new Set([...Object.keys(server.toolPolicies), ...(serverStatus.tool_names || [])]),
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
    select.value = server.toolPolicies[tool] || "ask";
    select.addEventListener("change", () => {
      server.toolPolicies = {
        ...server.toolPolicies,
        [tool]: select.value as McpServerSettings["toolPolicies"][string],
      };
    });
    row.appendChild(select);
  }
}
