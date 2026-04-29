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
            <div className="mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="h-20 w-20">
                <path id="home-track1" d="M 58,32 A 26,9 -18 0 1 6,32 A 26,9 -18 0 1 58,32" fill="none" stroke="#0066cc" strokeOpacity="0.2" strokeWidth="0.8"/>
                <path id="home-track2" d="M 52,32 A 20,6.8 35 0 1 12,32 A 20,6.8 35 0 1 52,32" fill="none" stroke="#8b5cf6" strokeOpacity="0.22" strokeWidth="0.8"/>
                <path id="home-track3" d="M 44,32 A 12,4.5 -50 0 1 20,32 A 12,4.5 -50 0 1 44,32" fill="none" stroke="#f59e0b" strokeOpacity="0.26" strokeWidth="0.8"/>
                <circle r="2.2" fill="#0066cc">
                  <animateMotion dur="11s" repeatCount="indefinite"><mpath href="#home-track1"/></animateMotion>
                </circle>
                <circle r="1.9" fill="#8b5cf6">
                  <animateMotion dur="8s" repeatCount="indefinite"><mpath href="#home-track2"/></animateMotion>
                </circle>
                <circle r="1.7" fill="#f59e0b">
                  <animateMotion dur="6s" repeatCount="indefinite"><mpath href="#home-track3"/></animateMotion>
                </circle>
                {/* ripple 1 */}
                <circle cx="32" cy="32" r="6.5" fill="none" stroke="#0066cc" strokeOpacity="0" strokeWidth="1.2">
                  <animate attributeName="r" values="5;12;5" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="stroke-opacity" values="0.35;0;0" dur="3s" repeatCount="indefinite"/>
                </circle>
                {/* ripple 2 */}
                <circle cx="32" cy="32" r="6.5" fill="none" stroke="#0066cc" strokeOpacity="0" strokeWidth="0.8">
                  <animate attributeName="r" values="5;12;5" dur="3s" begin="1.5s" repeatCount="indefinite"/>
                  <animate attributeName="stroke-opacity" values="0.25;0;0" dur="3s" begin="1.5s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy="32" r="5.8" fill="#0066cc">
                  <animate attributeName="r" values="4;6.5;4" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.75;1;0.75" dur="3s" repeatCount="indefinite"/>
                </circle>
              </svg>
            </div>
            <div className="section-kicker">Axis</div>
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
                  <h3 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">{t(entry.titleKey)}</h3>
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
