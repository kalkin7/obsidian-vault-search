import { Notice, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import { MAX_MCP_SERVERS } from "./constants";
import { describeMcpServer } from "./mcp-server-form";
import type { McpStatusResponse } from "./types";

const STATE_LABELS: Record<string, string> = {
  disabled: "비활성",
  awaiting_secret: "환경 변수 대기",
  connecting: "연결 중",
  connected: "연결됨",
  error: "오류",
};

/** MCP servers section (plan §12.3): a compact roster in the settings tab.
 *  All structural editing happens in McpServerEditorModal so rows never blur
 *  into unrelated sections below them. */
export function renderMcpSettings(
  containerEl: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
): void {
  containerEl.createEl("h3", { text: "MCP 서버" });

  new Setting(containerEl)
    .setName("로컬/원격 MCP 서버 사용")
    .setDesc(
      "등록한 MCP 서버의 도구를 API 모델이 발견하고 호출합니다. 새 도구는 기본적으로 실행 전 승인을 요구합니다.",
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

  for (const server of draft.mcpServers || []) {
    renderServerRow(containerEl, owner, server);
  }

  new Setting(containerEl)
    .setName("서버 추가")
    .setDesc(`최대 ${MAX_MCP_SERVERS}개까지 등록할 수 있습니다. 저장은 입력창에서 완료합니다.`)
    .addButton((button) =>
      button.setButtonText("추가").onClick(() => {
        if ((draft.mcpServers || []).length >= MAX_MCP_SERVERS) {
          new Notice(`MCP 서버는 최대 ${MAX_MCP_SERVERS}개입니다.`, 5000);
          return;
        }
        owner.openMcpServerEditor();
      }),
    );
}

function renderServerRow(
  containerEl: HTMLElement,
  owner: VaultSearchPlugin,
  server: VaultSearchPlugin["draftSettings"]["mcpServers"][number],
): void {
  const kindLabel =
    server.transport === "http" ? "원격 URL" : "로컬 명령";
  new Setting(containerEl)
    .setName(server.name || "(이름 없음)")
    .setDesc(`${kindLabel} · ${describeMcpServer(server)}`)
    .addToggle((toggle) =>
      toggle.setValue(server.enabled).onChange((value) => {
        server.enabled = value;
      }),
    )
    .addButton((button) =>
      button
        .setButtonText("수정")
        .setTooltip("이 서버의 연결 방식·명령·환경 변수를 편집합니다")
        .onClick(() => owner.openMcpServerEditor(server.id)),
    )
    .addButton((button) =>
      button
        .setButtonText("삭제")
        .setWarning()
        .onClick(async () => {
          if (!window.confirm(`MCP 서버 '${server.name}'을(를) 삭제할까요?`))
            return;
          await owner.deleteMcpServer(server.id);
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
  if (!status.enabled) {
    lines.push(
      "MCP가 전역적으로 꺼져 있습니다 — 위의 '로컬/원격 MCP 서버 사용' 스위치를 켜고 저장하세요.",
    );
  }
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
