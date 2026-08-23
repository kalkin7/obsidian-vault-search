import { Notice, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import { MAX_SKILL_ROOTS } from "./constants";
import type { SkillRootSettings, SkillsStatusResponse } from "./types";

const PROJECT_ROOT_SUGGESTIONS = [
  { id: "project:.claude", path: ".claude/skills", label: "Claude Code (.claude/skills)" },
  { id: "project:.agents", path: ".agents/skills", label: "범용 에이전트 (.agents/skills)" },
  { id: "project:.opencode", path: ".opencode/skills", label: "OpenCode (.opencode/skills)" },
];

const STATE_LABELS: Record<string, string> = {
  ok: "정상",
  disabled: "비활성",
  missing: "경로 없음",
  error: "오류",
};

/** Skills section (plan §8.3, §12.3): root management plus per-skill
 *  enablement with a rescan button. Discovery state comes from the backend
 *  registry; the draft only stores user decisions. */
export function renderSkillSettings(
  containerEl: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
): void {
  containerEl.createEl("h3", { text: "스킬" });

  new Setting(containerEl)
    .setName("스킬 사용")
    .setDesc(
      "볼트와 사용자가 지정한 경로의 SKILL.md를 카탈로그로 제공하고, 모델이 필요한 스킬만 점진적으로 불러옵니다. 스크립트는 실행하지 않습니다.",
    )
    .addToggle((toggle) =>
      toggle.setValue(draft.skillsEnabled).onChange((value) => {
        draft.skillsEnabled = value;
      }),
    );

  const statusBox = containerEl.createDiv({
    cls: "vault-search-skill-status",
    text: "스킬 상태를 확인하는 중…",
  });

  const rootsContainer = containerEl.createDiv({
    cls: "vault-search-skill-roots",
  });
  const skillsContainer = containerEl.createDiv({
    cls: "vault-search-skill-catalog",
  });

  const renderStatus = (status: SkillsStatusResponse | null) => {
    if (!status) {
      statusBox.setText(
        "백엔드가 실행 중이 아닙니다. 시작 후 상태가 표시됩니다.",
      );
      return;
    }
    statusBox.empty();
    const lines: string[] = [
      `활성 스킬 ${status.active_count}개 · 카탈로그 약 ${status.catalog_chars}자`,
    ];
    for (const root of status.roots) {
      const label = STATE_LABELS[root.state] || root.state;
      lines.push(
        `${root.id}: ${label}${root.message ? ` (${root.message})` : ""} · 스킬 ${root.skills}개`,
      );
    }
    for (const conflict of status.conflicts) lines.push(`충돌: ${conflict}`);
    for (const problem of status.problems) lines.push(`경고: ${problem}`);
    statusBox.setText(lines.join("\n"));
    renderCatalog(skillsContainer, owner, draft, status);
  };

  void owner.refreshSkillsStatus().then(renderStatus).catch(() => renderStatus(null));

  renderRoots(rootsContainer, owner, draft);

  new Setting(containerEl)
    .setName("스킬 루트 추가")
    .setDesc("볼트 기준 상대 경로(권장) 또는 절대 경로. 루트 바로 아래의 */SKILL.md을 탐색합니다.")
    .addButton((button) =>
      button.setButtonText("루트 추가").onClick(() => {
        if ((draft.skillRoots || []).length >= MAX_SKILL_ROOTS) {
          new Notice(`스킬 루트는 최대 ${MAX_SKILL_ROOTS}개입니다.`, 5000);
          return;
        }
        const pathInput = document.createElement("input");
        pathInput.type = "text";
        pathInput.placeholder = ".claude/skills";
        pathInput.setAttribute("aria-label", "새 스킬 루트 경로");
        const row = containerEl.createDiv({ cls: "vault-search-skill-add-row" });
        row.appendChild(pathInput);
        row.createEl("button", { text: "확인", attr: { type: "button" } })
          .addEventListener("click", () => {
            const value = pathInput.value.trim().replace(/\\/g, "/");
            if (!value) return;
            const id = `custom-${Date.now().toString(36)}`;
            draft.skillRoots = [
              ...(draft.skillRoots || []),
              { id, path: value, enabled: true } satisfies SkillRootSettings,
            ];
            row.remove();
            owner.settingTab?.display();
          });
      }),
    );

  new Setting(containerEl)
    .setName("다시 검색")
    .setDesc("백엔드의 스킬 레지스트리를 다시 스캔합니다.")
    .addButton((button) =>
      button.setButtonText("검색").onClick(async () => {
        try {
          const status = await owner.rescanSkills();
          renderStatus(status);
          new Notice("스킬 탐색을 완료했습니다.", 4000);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
        }
      }),
    );
}

function renderRoots(
  container: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
): void {
  for (const suggestion of PROJECT_ROOT_SUGGESTIONS) {
    const present = (draft.skillRoots || []).some(
      (root) => root.path === suggestion.path && root.enabled,
    );
    new Setting(container)
      .setName(suggestion.label)
      .setDesc(present ? "사용 중" : "발견된 프로젝트 스킬 루트")
      .addButton((button) =>
        button
          .setButtonText(present ? "사용 중" : "프로젝트 스킬 사용")
          .setDisabled(present)
          .onClick(() => {
            draft.skillRoots = [
              ...(draft.skillRoots || []),
              {
                id: suggestion.id,
                path: suggestion.path,
                enabled: true,
              } satisfies SkillRootSettings,
            ];
            owner.settingTab?.display();
          }),
      );
  }
  for (const root of draft.skillRoots || []) {
    if (root.path.startsWith(".claude/skills") && root.id === "project:.claude")
      continue;
    if (root.path.startsWith(".agents/skills") && root.id === "project:.agents")
      continue;
    if (root.path.startsWith(".opencode/skills") && root.id === "project:.opencode")
      continue;
    new Setting(container)
      .setName(root.path)
      .setDesc(root.enabled ? "활성" : "비활성")
      .addToggle((toggle) =>
        toggle.setValue(root.enabled).onChange((value) => {
          root.enabled = value;
        }),
      )
      .addButton((button) =>
        button.setButtonText("제거").onClick(() => {
          draft.skillRoots = (draft.skillRoots || []).filter(
            (entry) => entry.id !== root.id,
          );
          owner.settingTab?.display();
        }),
      );
  }
}

function renderCatalog(
  container: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
  status: SkillsStatusResponse,
): void {
  container.empty();
  if (!status.skills.length) {
    container.createEl("div", {
      cls: "setting-item-description",
      text: "발견된 스킬이 없습니다. SKILL.md가 포함된 폴더를 루트로 추가하세요.",
    });
    return;
  }
  // Empty selection means "no active skills" (backend enforces the same
  // rule), so every state is explicit: select-all writes every discovered
  // canonical id into the array, clear empties it, and individual toggles
  // persist through the normal settings save flow.
  const selected = new Set(draft.enabledSkills || []);
  container.createEl("div", {
    cls: "setting-item-description",
    text: `${selected.size}/${status.skills.length}개 선택 · 선택하지 않은 스킬은 모델에 노출되지 않습니다.`,
  });
  const actions = container.createDiv({ cls: "vault-search-skill-catalog-actions" });
  const selectAll = actions.createEl("button", {
    text: "모두 선택",
    attr: { type: "button" },
  });
  selectAll.addEventListener("click", () => {
    draft.enabledSkills = status.skills.map((skill) => skill.id);
    owner.settingTab?.display();
  });
  const clearAll = actions.createEl("button", {
    text: "모두 해제",
    attr: { type: "button" },
  });
  clearAll.addEventListener("click", () => {
    draft.enabledSkills = [];
    owner.settingTab?.display();
  });
  for (const skill of status.skills) {
    const setting = new Setting(container)
      .setName(skill.name)
      .setDesc(`${skill.description || "(설명 없음)"}`);
    setting.addToggle((toggle) =>
      toggle.setValue(selected.has(skill.id)).onChange((value) => {
        const next = new Set(draft.enabledSkills || []);
        if (value) next.add(skill.id);
        else next.delete(skill.id);
        draft.enabledSkills = [...next];
      }),
    );
  }
}
