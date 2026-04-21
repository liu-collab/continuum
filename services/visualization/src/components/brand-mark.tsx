import React from "react";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  animated?: boolean;
};

export function BrandMark({ className, animated = false }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      fill="none"
    >
      <defs>
        <linearGradient id="brand-shell" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#27272a" />
          <stop offset="1" stopColor="#18181b" />
        </linearGradient>
        <linearGradient id="brand-core" x1="22" y1="18" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fafaf9" />
          <stop offset="1" stopColor="#e7e5e4" />
        </linearGradient>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="18" fill="url(#brand-shell)" />
      <rect x="4.75" y="4.75" width="54.5" height="54.5" rx="17.25" stroke="#3f3f46" strokeWidth="1.5" />

      <g opacity="0.92">
        <path
          d="M20 25.5C20 20.2533 24.2533 16 29.5 16H34.5C39.7467 16 44 20.2533 44 25.5V38.5C44 43.7467 39.7467 48 34.5 48H29.5C24.2533 48 20 43.7467 20 38.5V25.5Z"
          stroke="url(#brand-core)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="25" y="22" width="14" height="4.5" rx="2.25" fill="#f5f5f4" opacity={animated ? undefined : 0.9}>
          {animated ? (
            <animate attributeName="opacity" values="0.65;1;0.65" dur="2.2s" repeatCount="indefinite" />
          ) : null}
        </rect>
        <rect x="25" y="29.75" width="10.5" height="4.5" rx="2.25" fill="#d6d3d1">
          {animated ? (
            <animate attributeName="width" values="10.5;12.5;10.5" dur="1.8s" repeatCount="indefinite" />
          ) : null}
        </rect>
        <rect x="25" y="37.5" width="14" height="4.5" rx="2.25" fill="#f5f5f4" opacity={animated ? undefined : 0.9}>
          {animated ? (
            <animate attributeName="opacity" values="1;0.62;1" dur="1.9s" repeatCount="indefinite" />
          ) : null}
        </rect>
      </g>

      <g transform="translate(32 32)">
        <circle
          r="19"
          stroke="#52525b"
          strokeWidth="1.5"
          strokeDasharray="3 6"
          opacity="0.85"
          transform={animated ? undefined : "rotate(-18)"}
        >
          {animated ? (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0"
              to="360"
              dur="8s"
              repeatCount="indefinite"
            />
          ) : null}
        </circle>
      </g>

      {animated ? (
        <g>
          <circle cx="51" cy="32" r="3.5" fill="#fafaf9">
            <animateMotion dur="4s" repeatCount="indefinite" rotate="auto">
              <mpath href="#brand-orbit-path" />
            </animateMotion>
            <animate attributeName="r" values="3.3;4;3.3" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <path id="brand-orbit-path" d="M51 32a19 19 0 1 1-38 0a19 19 0 1 1 38 0" opacity="0" />
        </g>
      ) : (
        <circle cx="49.5" cy="24.5" r="3.7" fill="#fafaf9" />
      )}
    </svg>
  );
}
