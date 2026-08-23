import { Notice, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import { MAX_PROJECT_RULES_CHARS } from "./constants";

/** Project-rules section (plan §7.1): a bounded textarea plus a snapshot
 *  import of the vault-root AGENTS.md. The content is sent to the API
 *  provider as a system-instruction section — the help text must say so. */
export function renderApiAgentSettings(
  containerEl: HTMLElement,
  owner: VaultSearchPlugin,
  draft: VaultSearchPlugin["draftSettings"],
): void {
  containerEl.createEl("h3", { text: "API 에이전트 규칙" });

  const metaText = () => {
    const length = (draft.answerProjectRules || "").length;
    const parts = [`현재 ${length}자 / 최대 ${MAX_PROJECT_RULES_CHARS}자`];
    if (draft.answerProjectRulesSource === "agents-md") {
      parts.push("출처: AGENTS.md 가져오기");
      if (draft.answerProjectRulesImportedAt) {
        const date = new Date(draft.answerProjectRulesImportedAt);
        if (!Number.isNaN(date.getTime())) {
          parts.push(`가져온 시각: ${date.toLocaleString()}`);
        }
      }
      if (draft.answerProjectRulesHash) {
        parts.push(`SHA-256: ${draft.answerProjectRulesHash}`);
      }
    }
    return parts.join(" · ");
  };

  const rulesSetting = new Setting(containerEl)
    .setName("프로젝트 규칙")
    .setDesc(
      "API provider에 전송되는 프로젝트 지침입니다. 제품 보안 규칙·도구 승인·볼트 경계보다 우선하지 않습니다. 민감한 값(API 키, 비밀번호 등)은 넣지 마세요.",
    )
    .setClass("vault-search-project-rules");

  const control = rulesSetting.controlEl;
  control.addClass("vault-search-project-rules-control");
  const counter = control.createDiv({
    cls: "vault-search-project-rules-meta",
    text: metaText(),
  });
  const textarea = document.createElement("textarea");
  textarea.className = "vault-search-project-rules-textarea";
  textarea.rows = 6;
  textarea.spellcheck = false;
  textarea.value = draft.answerProjectRules || "";
  textarea.setAttribute("aria-label", "프로젝트 규칙 편집");
  textarea.addEventListener("input", () => {
    let value = textarea.value;
    if (value.length > MAX_PROJECT_RULES_CHARS) {
      value = value.slice(0, MAX_PROJECT_RULES_CHARS);
      textarea.value = value;
      new Notice(
        `프로젝트 규칙은 최대 ${MAX_PROJECT_RULES_CHARS}자까지 입력할 수 있습니다.`,
        5000,
      );
    }
    draft.answerProjectRules = value;
    if (draft.answerProjectRulesSource === "agents-md" && value) {
      // Editing an imported snapshot turns it into custom text.
      draft.answerProjectRulesSource = "custom";
    }
    counter.setText(metaText());
  });
  control.appendChild(textarea);

  new Setting(containerEl)
    .setName("AGENTS.md 가져오기")
    .setDesc(
      "볼트 루트의 AGENTS.md 내용을 위 입력창으로 복사합니다(스냅샷). 이후 파일이 바뀌어도 자동 반영되지 않으며, 설정 적용 시 저장됩니다.",
    )
    .addButton((button) =>
      button.setButtonText("가져오기").onClick(async () => {
        try {
          await owner.importAgentsMd();
          textarea.value = draft.answerProjectRules || "";
          counter.setText(metaText());
        } catch (error) {
          new Notice(
            error instanceof Error ? error.message : String(error),
            8000,
          );
        }
      }),
    )
    .addButton((button) =>
      button.setButtonText("비우기").onClick(() => {
        owner.clearProjectRules();
        textarea.value = "";
        counter.setText(metaText());
      }),
    );
}
