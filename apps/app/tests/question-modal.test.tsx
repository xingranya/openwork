import { describe, expect, test } from "bun:test";
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QuestionPanel } from "../src/react-app/domains/session/modals/question-modal";

function renderQuestion(question: QuestionInfo) {
  return renderToStaticMarkup(
    React.createElement(QuestionPanel, {
      questions: [question],
      busy: false,
      onReply: () => {},
    }),
  );
}

describe("QuestionPanel", () => {
  test("shows custom answer input when custom is omitted", () => {
    const html = renderQuestion({
      header: "Choice",
      question: "Pick one",
      options: [{ label: "Yes", description: "Proceed" }],
    });

    expect(html).toContain("或输入自定义回答");
    expect(html).toContain("在此输入你的回答…");
  });

  test("hides custom answer input when custom is false", () => {
    const html = renderQuestion({
      header: "Choice",
      question: "Pick one",
      options: [{ label: "Yes", description: "Proceed" }],
      custom: false,
    });

    expect(html).not.toContain("或输入自定义回答");
    expect(html).not.toContain("在此输入你的回答…");
  });
});
