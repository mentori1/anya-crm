"use client";

import Image from "next/image";
import { useState } from "react";
import { initials } from "@/lib/format";

export function Avatar({ name, src, size = 44, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`person-avatar photo-avatar ${className}`} style={{ width: size, height: size, flexBasis: size, fontSize: Math.max(10, size * .26) }}>
      {src && !failed ? <Image src={src} alt={name} width={size} height={size} unoptimized onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}
