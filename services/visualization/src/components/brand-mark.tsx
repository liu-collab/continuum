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
        <radialGradient id="brand-halo" cx="50%" cy="42%" r="64%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#f3f7fb" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </radialGradient>
        <linearGradient id="brand-ring" x1="16" y1="16" x2="50" y2="49" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
        <linearGradient id="brand-trace" x1="18" y1="24" x2="49" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
        <linearGradient id="brand-orbit-a" x1="22" y1="22" x2="46" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="brand-orbit-b" x1="24" y1="26" x2="44" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <radialGradient id="brand-core" cx="50%" cy="50%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </radialGradient>
        <filter id="brand-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#cbd5e1" floodOpacity="0.3" />
        </filter>
      </defs>

      <g filter="url(#brand-shadow)">
        <circle cx="32" cy="32" r="23.5" fill="url(#brand-halo)">
          {animated ? (
            <animate attributeName="opacity" values="0.94;1;0.94" dur="4.8s" repeatCount="indefinite" />
          ) : null}
        </circle>
      </g>

      <circle cx="32" cy="32" r="23.5" stroke="#ffffff" strokeOpacity="0.82" strokeWidth="1" />

      <g transform="translate(34 34)">
        <g transform="rotate(-18)">
          <ellipse
            cx="0"
            cy="0"
            rx="19.5"
            ry="10.2"
            stroke="#60a5fa"
            strokeOpacity="0.16"
            strokeWidth="1.15"
          />
          <g transform={animated ? undefined : "rotate(12)"}>
            {animated ? (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 0 0"
                to="360 0 0"
                dur="11.5s"
                repeatCount="indefinite"
              />
            ) : null}
            <ellipse
              cx="0"
              cy="0"
              rx="19.5"
              ry="10.2"
              stroke="url(#brand-ring)"
              strokeWidth="4.8"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="42 58"
              strokeDashoffset="12"
            />
          </g>
        </g>

        <g transform="rotate(67)">
          <ellipse
            cx="0"
            cy="0"
            rx="18.2"
            ry="7.4"
            stroke="#2dd4bf"
            strokeOpacity="0.15"
            strokeWidth="1.05"
          />
          <g transform={animated ? undefined : "rotate(-54)"}>
            {animated ? (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 0 0"
                to="-360 0 0"
                dur="14s"
                repeatCount="indefinite"
              />
            ) : null}
            <ellipse
              cx="0"
              cy="0"
              rx="18.2"
              ry="7.4"
              stroke="url(#brand-trace)"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.96"
              pathLength="100"
              strokeDasharray="34 66"
              strokeDashoffset="54"
            />
          </g>
        </g>

        <g opacity="0.98">
          <g transform="rotate(18)">
            <ellipse
              cx="0"
              cy="0"
              rx="11.2"
              ry="6.2"
              stroke="#38bdf8"
              strokeOpacity="0.13"
              strokeWidth="0.95"
            />
            <g transform={animated ? undefined : "rotate(8)"}>
              {animated ? (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 0 0"
                  to="360 0 0"
                  dur="8.2s"
                  repeatCount="indefinite"
                />
              ) : null}
              <ellipse
                cx="0"
                cy="0"
                rx="11.2"
                ry="6.2"
                stroke="url(#brand-orbit-a)"
                strokeWidth="3.2"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="26 74"
                strokeDashoffset="8"
              />
            </g>
          </g>

          <g transform="rotate(-43)">
            <ellipse
              cx="0"
              cy="0"
              rx="8.6"
              ry="4.1"
              stroke="#14b8a6"
              strokeOpacity="0.12"
              strokeWidth="0.9"
            />
            <g transform={animated ? undefined : "rotate(-48)"}>
              {animated ? (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 0 0"
                  to="-360 0 0"
                  dur="6.5s"
                  repeatCount="indefinite"
                />
              ) : null}
              <ellipse
                cx="0"
                cy="0"
                rx="8.6"
                ry="4.1"
                stroke="url(#brand-orbit-b)"
                strokeWidth="2.7"
                strokeLinecap="round"
                opacity="0.96"
                pathLength="100"
                strokeDasharray="22 78"
                strokeDashoffset="48"
              />
            </g>
          </g>

          <g transform="rotate(71)">
            <ellipse
              cx="0"
              cy="0"
              rx="5.9"
              ry="2.7"
              stroke="#22d3ee"
              strokeOpacity="0.11"
              strokeWidth="0.85"
            />
            <g transform={animated ? undefined : "rotate(18)"}>
              {animated ? (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 0 0"
                  to="360 0 0"
                  dur="4.8s"
                  repeatCount="indefinite"
                />
              ) : null}
              <ellipse
                cx="0"
                cy="0"
                rx="5.9"
                ry="2.7"
                stroke="url(#brand-trace)"
                strokeWidth="2.2"
                strokeLinecap="round"
                opacity="0.95"
                pathLength="100"
                strokeDasharray="18 82"
                strokeDashoffset="18"
              />
            </g>
          </g>
        </g>
      </g>

      <circle cx="34" cy="34" r="4.8" fill="url(#brand-core)">
        {animated ? (
          <>
            <animate attributeName="r" values="4.6;5.2;4.6" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.92;1;0.92" dur="3.6s" repeatCount="indefinite" />
          </>
        ) : null}
      </circle>

      <circle cx="34" cy="34" r="9.5" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" />
    </svg>
  );
}
