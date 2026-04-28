"use client";

import React from "react";

import { ErrorState } from "@/components/error-state";

export function PageError({
  error,
  reset,
  title,
  description,
  retryLabel,
  kicker,
  heading,
  subtitle,
  testId = "page-error-state"
}: {
  error: Error;
  reset: () => void;
  title: string;
  description?: string;
  retryLabel: string;
  kicker?: string;
  heading?: string;
  subtitle?: string;
  testId?: string;
}) {
  const message = description ?? error.message ?? title;

  return (
    <div className="app-page" data-testid={testId}>
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              {kicker ? <div className="section-kicker">{kicker}</div> : null}
              <h1 className="tile-title">{heading ?? title}</h1>
              {subtitle ? <p className="tile-subtitle">{subtitle}</p> : null}
            </div>
            <button type="button" onClick={reset} className="button-primary">
              {retryLabel}
            </button>
          </div>
          <ErrorState title={title} description={message} />
        </div>
      </section>
    </div>
  );
}
