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
      <circle cx="32" cy="32" r="24" fill="#ffffff" stroke="#e0e0e0" strokeWidth="1" />

      <g transform="translate(34 34)">
        <g transform="rotate(-18)">
          <ellipse
            cx="0"
            cy="0"
            rx="19.5"
            ry="10.2"
            stroke="#0066cc"
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
              stroke="#0066cc"
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
            stroke="#0066cc"
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
              stroke="#2997ff"
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
              stroke="#0066cc"
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
                stroke="#0066cc"
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
              stroke="#0066cc"
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
                stroke="#2997ff"
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
              stroke="#0066cc"
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
                stroke="#2997ff"
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

      <circle cx="34" cy="34" r="4.8" fill="#0066cc">
        {animated ? (
          <>
            <animate attributeName="r" values="4.6;5.2;4.6" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.92;1;0.92" dur="3.6s" repeatCount="indefinite" />
          </>
        ) : null}
      </circle>

      <circle cx="34" cy="34" r="9.5" stroke="#0066cc" strokeOpacity="0.16" strokeWidth="1.5" />
    </svg>
  );
}
