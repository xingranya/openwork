"use client";

import { buttonVariants } from "../../_components/ui/button";

const ENTERPRISE_CONTACT_URL = process.env.NEXT_PUBLIC_ENTERPRISE_CONTACT_URL?.trim() ?? "";

type Props = {
  feature: string;
};

export function EnterprisePlanNotice(props: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5">
      <div className="min-w-[260px] flex-1 text-[14px] text-amber-900">
        <p className="font-semibold">{props.feature}属于企业版功能。</p>
        <p className="mt-1">
          当前配置可以继续使用。企业版支持 SSO / SAML、SCIM、桌面策略和托管部署。
        </p>
      </div>
      {ENTERPRISE_CONTACT_URL ? (
        <a
          href={ENTERPRISE_CONTACT_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "primary" })}
        >
          查看公司方案说明
        </a>
      ) : (
        <span className="text-[13px] font-medium text-amber-800">请联系公司管理员</span>
      )}
    </div>
  );
}
