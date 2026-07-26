"use client";

import { useState } from "react";
import { Store } from "lucide-react";

/** 能力市场图标，加载失败时回退到通用商店图标。 */
export function MarketplaceLogo({
  logoUrl,
  name,
  imgClassName,
  iconClassName,
}: {
  logoUrl: string | null;
  name: string;
  imgClassName: string;
  iconClassName: string;
}) {
  const [erroredUrl, setErroredUrl] = useState<string | null>(null);

  if (!logoUrl || erroredUrl === logoUrl) {
    return <Store className={`${iconClassName} text-gray-700`} aria-hidden />;
  }

  return (
    <img
      src={logoUrl}
      alt={`${name} 标志`}
      onError={() => setErroredUrl(logoUrl)}
      className={`${imgClassName} object-contain`}
    />
  );
}
