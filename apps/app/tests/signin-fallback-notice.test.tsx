import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SignInFallbackNotice } from "../src/react-app/domains/cloud/signin-fallback-notice";

test("登录回退会显示完整且可点击的链接", () => {
  const url = "https://example.com/sign-in?state=visible";
  const html = renderToStaticMarkup(<SignInFallbackNotice url={url} />);

  expect(html).toContain(`href="${url}"`);
  expect(html).toContain(url);
  expect(html).toContain("复制登录链接");
});
