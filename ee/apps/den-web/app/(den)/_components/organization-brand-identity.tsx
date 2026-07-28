"use client";

import { useState } from "react";

export type OrganizationBrand = {
  appName: string;
  logoUrl: string | null;
  iconUrl: string | null;
};

export function OrganizationBrandIdentity({
  organizationName,
  brand,
  className = "",
}: {
  organizationName: string;
  brand: OrganizationBrand;
  className?: string;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const showLogo = Boolean(brand.logoUrl && brand.logoUrl !== failedLogoUrl);
  const showIcon = Boolean(brand.iconUrl && brand.iconUrl !== failedIconUrl);

  if (showLogo && brand.logoUrl) {
    return (
      // 公司资源可能来自内网地址，因此不会出现在当前部署的图片代理白名单中。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={`${organizationName} 公司标志`}
        className={`inline-block max-h-[1.08em] max-w-[12rem] shrink-0 object-contain align-middle ${className}`}
        onError={() => setFailedLogoUrl(brand.logoUrl)}
      />
    );
  }

  return (
    <span className={`inline ${className}`}>
      {showIcon && brand.iconUrl ? (
        // 内网资源说明见上方注释。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.iconUrl}
          alt=""
          className="mr-[0.24em] inline-block size-[1em] rounded-[0.22em] object-contain align-[-0.12em]"
          onError={() => setFailedIconUrl(brand.iconUrl)}
        />
      ) : null}
      <span>{organizationName}</span>
    </span>
  );
}
