import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeepLinkDelivery,
  shouldResetDeepLinkDeliveryForNavigation,
} from "./deep-link-delivery.mjs";

test("渲染器未就绪时暂存深层链接，就绪后只投递一次", () => {
  const delivered = [];
  const delivery = createDeepLinkDelivery((urls) => delivered.push(urls));

  assert.deepEqual(delivery.enqueue([" foxwork://den-auth?grant=one "]), []);
  assert.deepEqual(delivery.pendingUrls(), ["foxwork://den-auth?grant=one"]);
  assert.deepEqual(delivery.setRendererReady(true), ["foxwork://den-auth?grant=one"]);
  assert.deepEqual(delivery.setRendererReady(true), []);
  assert.deepEqual(delivered, [["foxwork://den-auth?grant=one"]]);
});

test("就绪后到达的链接立即投递，页面重载会重新排队", () => {
  const delivered = [];
  const delivery = createDeepLinkDelivery((urls) => delivered.push(urls));

  delivery.setRendererReady(true);
  assert.deepEqual(delivery.enqueue(["foxwork://den-auth?grant=one"]), ["foxwork://den-auth?grant=one"]);
  delivery.reset();
  assert.equal(delivery.isReady(), false);
  assert.deepEqual(delivery.enqueue(["foxwork://den-auth?grant=two"]), []);
  assert.deepEqual(delivery.setRendererReady(true), ["foxwork://den-auth?grant=two"]);
  assert.deepEqual(delivered, [
    ["foxwork://den-auth?grant=one"],
    ["foxwork://den-auth?grant=two"],
  ]);
});

test("发送失败时保留待投递链接，便于下一次就绪握手重试", () => {
  let attempts = 0;
  const delivery = createDeepLinkDelivery(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("渲染器已退出");
  });

  delivery.enqueue(["foxwork://den-auth?grant=retry"]);
  assert.throws(() => delivery.setRendererReady(true), /渲染器已退出/);
  assert.deepEqual(delivery.pendingUrls(), ["foxwork://den-auth?grant=retry"]);
  assert.deepEqual(delivery.setRendererReady(true), ["foxwork://den-auth?grant=retry"]);
  assert.deepEqual(delivery.pendingUrls(), []);
});

test("忽略空链接和非字符串值", () => {
  const delivered = [];
  const delivery = createDeepLinkDelivery((urls) => delivered.push(urls));
  delivery.setRendererReady(true);
  assert.deepEqual(delivery.enqueue(["", "  ", null, 1, "foxwork://connect"]), ["foxwork://connect"]);
  assert.deepEqual(delivered, [["foxwork://connect"]]);
});

test("只在允许的主框架换页前重置深层链接投递", () => {
  assert.equal(
    shouldResetDeepLinkDeliveryForNavigation({
      isMainFrame: true,
      isInPlace: false,
      isAllowed: true,
    }),
    true,
  );
  assert.equal(
    shouldResetDeepLinkDeliveryForNavigation({
      isMainFrame: true,
      isInPlace: false,
      isAllowed: false,
    }),
    false,
  );
  assert.equal(
    shouldResetDeepLinkDeliveryForNavigation({
      isMainFrame: true,
      isInPlace: true,
      isAllowed: true,
    }),
    false,
  );
  assert.equal(
    shouldResetDeepLinkDeliveryForNavigation({
      isMainFrame: false,
      isInPlace: false,
      isAllowed: true,
    }),
    false,
  );
});
