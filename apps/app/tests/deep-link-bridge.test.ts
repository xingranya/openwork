import { describe, expect, test } from "bun:test";
import {
  consumePendingDeepLinks,
  drainPendingDeepLinks,
  pushPendingDeepLinks,
} from "../src/app/lib/deep-link-bridge";

function createTarget() {
  const events: Event[] = [];
  const target = {
    __OPENWORK__: {},
    dispatchEvent(event: Event) {
      events.push(event);
      return true;
    },
  } as unknown as Window;
  return { target, events };
}

describe("deep-link bridge", () => {
  test("不同路由只取走自己能够处理的待处理链接", () => {
    const { target } = createTarget();
    const authLink = "foxwork://den-auth?grant=auth";
    const connectLink = "foxwork://connect?token=signed";
    pushPendingDeepLinks(target, [authLink, connectLink]);

    expect(drainPendingDeepLinks(target, (url) => url.includes("den-auth"))).toEqual([authLink]);
    expect(target.__OPENWORK__?.deepLinks).toEqual([connectLink]);
    expect(drainPendingDeepLinks(target, (url) => url.includes("connect"))).toEqual([connectLink]);
    expect(target.__OPENWORK__?.deepLinks).toEqual([]);
  });

  test("事件处理完成后只移除对应链接，不影响尚未挂载的消费者", () => {
    const { target, events } = createTarget();
    const authLink = "foxwork://den-auth?grant=auth";
    const connectLink = "foxwork://connect?token=signed";
    pushPendingDeepLinks(target, [authLink, connectLink]);

    expect(events).toHaveLength(1);
    consumePendingDeepLinks(target, [authLink]);
    expect(target.__OPENWORK__?.deepLinks).toEqual([connectLink]);
  });

  test("重复链接按出现次数消费", () => {
    const { target } = createTarget();
    const link = "foxwork://den-auth?grant=repeat";
    pushPendingDeepLinks(target, [link, link]);
    consumePendingDeepLinks(target, [link]);
    expect(target.__OPENWORK__?.deepLinks).toEqual([link]);
  });
});
