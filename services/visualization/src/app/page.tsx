import type { Route } from "next";
import Link from "next/link";
import React from "react";
import { Bot, BookOpenText, Database, GitBranch, HeartPulse, ShieldCheck } from "lucide-react";

import { getServerTranslator } from "@/lib/i18n/server";

const entries = [
  {
    href: "/dashboard" as Route,
    titleKey: "home.entries.dashboardTitle",
    descriptionKey: "home.entries.dashboardDescription",
    icon: HeartPulse
  },
  {
    href: "/memories" as Route,
    titleKey: "home.entries.memoriesTitle",
    descriptionKey: "home.entries.memoriesDescription",
    icon: Database
  },
  {
    href: "/runs" as Route,
    titleKey: "home.entries.runsTitle",
    descriptionKey: "home.entries.runsDescription",
    icon: GitBranch
  },
  {
    href: "/governance" as Route,
    titleKey: "home.entries.governanceTitle",
    descriptionKey: "home.entries.governanceDescription",
    icon: ShieldCheck
  },
  {
    href: "/docs/configuration" as Route,
    titleKey: "home.entries.docsTitle",
    descriptionKey: "home.entries.docsDescription",
    icon: BookOpenText
  },
  {
    href: "/agent" as Route,
    titleKey: "home.entries.agentTitle",
    descriptionKey: "home.entries.agentDescription",
    icon: Bot
  }
];

export default async function HomePage() {
  const { t } = await getServerTranslator();

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">Continuum</div>
            <h1 className="tile-title">{t("home.heroTitle")}</h1>
            <p className="tile-subtitle">{t("home.heroDescription")}</p>
          </div>
          <div className="tile-actions">
            <Link href={"/dashboard" as Route} className="button-primary">{t("home.primaryAction")}</Link>
            <Link href={"/agent" as Route} className="button-secondary-pill">{t("home.secondaryAction")}</Link>
          </div>
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("home.workflowKicker")}</div>
            <h2 className="tile-title">{t("home.workflowTitle")}</h2>
            <p className="tile-subtitle">{t("home.workflowDescription")}</p>
          </div>
          <div className="utility-grid">
            {entries.map((entry) => {
              const Icon = entry.icon;

              return (
                <Link key={entry.href} href={entry.href} className="record-link">
                  <div className="icon-button mb-5">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{t(entry.titleKey)}</h3>
                  <p className="mt-3 text-[17px] leading-[1.47] text-muted">{t(entry.descriptionKey)}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
