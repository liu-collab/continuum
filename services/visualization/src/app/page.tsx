import type { Route } from "next";
import Link from "next/link";
import React from "react";
import { Activity, ArrowRight, BarChart3, BookOpenText, Bot, Database, GitBranch, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/server";

const abilities = [
  { href: "/dashboard" as Route, titleKey: "home.entries.dashboardTitle", descriptionKey: "home.entries.dashboardDescription", icon: BarChart3 },
  { href: "/memories" as Route, titleKey: "home.entries.memoriesTitle", descriptionKey: "home.entries.memoriesDescription", icon: Database },
  { href: "/runs" as Route, titleKey: "home.entries.runsTitle", descriptionKey: "home.entries.runsDescription", icon: GitBranch },
  { href: "/governance" as Route, titleKey: "home.entries.governanceTitle", descriptionKey: "home.entries.governanceDescription", icon: ShieldCheck },
  { href: "/docs/configuration" as Route, titleKey: "home.entries.docsTitle", descriptionKey: "home.entries.docsDescription", icon: BookOpenText },
  { href: "/agent" as Route, titleKey: "home.entries.agentTitle", descriptionKey: "home.entries.agentDescription", icon: Bot },
];

const steps = [
  { icon: Plug, titleKey: "home.step1Title", descriptionKey: "home.step1Description" },
  { icon: RefreshCw, titleKey: "home.step2Title", descriptionKey: "home.step2Description" },
  { icon: Activity, titleKey: "home.step3Title", descriptionKey: "home.step3Description" },
];

export default async function HomePage() {
  const { t } = await getServerTranslator();

  return (
    <div className="app-page">

      {/* Hero */}
      <section className="tile tile-light">
        <div className="tile-inner" style={{ textAlign: "center" as const }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="mx-auto mb-8 h-20 w-20">
                <path id="hero-track1" d="M 54,32 A 22,8.5 -18 0 1 10,32 A 22,8.5 -18 0 1 54,32" fill="none" stroke="#0066cc" strokeOpacity="0.2" strokeWidth="0.8"/>
                <path id="hero-track2" d="M 49,32 A 17,6.2 35 0 1 15,32 A 17,6.2 35 0 1 49,32" fill="none" stroke="#8b5cf6" strokeOpacity="0.22" strokeWidth="0.8"/>
                <path id="hero-track3" d="M 43,32 A 11,4.5 -50 0 1 21,32 A 11,4.5 -50 0 1 43,32" fill="none" stroke="#f59e0b" strokeOpacity="0.26" strokeWidth="0.8"/>
                <circle r="2.2" fill="#0066cc">
                  <animateMotion dur="11s" repeatCount="indefinite"><mpath href="#hero-track1"/></animateMotion>
                </circle>
                <circle r="1.9" fill="#8b5cf6">
                  <animateMotion dur="8s" repeatCount="indefinite"><mpath href="#hero-track2"/></animateMotion>
                </circle>
                <circle r="1.7" fill="#f59e0b">
                  <animateMotion dur="6s" repeatCount="indefinite"><mpath href="#hero-track3"/></animateMotion>
                </circle>
                <circle cx="32" cy="32" r="5" fill="none" stroke="#0066cc" strokeOpacity="0" strokeWidth="1.2">
                  <animate attributeName="r" values="5;12;5" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="stroke-opacity" values="0.35;0;0" dur="3s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy="32" r="5" fill="none" stroke="#0066cc" strokeOpacity="0" strokeWidth="0.8">
                  <animate attributeName="r" values="5;12;5" dur="3s" begin="1.5s" repeatCount="indefinite"/>
                  <animate attributeName="stroke-opacity" values="0.25;0;0" dur="3s" begin="1.5s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy="32" r="5.8" fill="#0066cc">
                  <animate attributeName="r" values="4;6.5;4" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.75;1;0.75" dur="3s" repeatCount="indefinite"/>
                </circle>
              </svg>
          <div className="section-kicker">Axis</div>
          <h1 className="page-title max-w-[800px] mx-auto">{t("home.heroTitle")}</h1>
          <p className="page-lead mt-6 max-w-[640px] mx-auto">{t("home.heroDescription")}</p>
          <div className="hero-actions mt-8">
            <Link href={"/agent" as Route} className="button-primary">
              {t("home.primaryAction")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head" style={{ alignItems: "center", textAlign: "center" as const }}>
            <div className="section-kicker">{t("home.howItWorksKicker")}</div>
            <h2 className="tile-title">{t("home.howItWorksTitle")}</h2>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={index} className="text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--cyan-bg)" }}>
                    <Icon className="h-6 w-6" style={{ color: "var(--primary)" }} />
                  </div>
                  <h3 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">{t(step.titleKey)}</h3>
                  <p className="mt-3 text-[17px] leading-[1.47] text-muted max-w-[280px] mx-auto">{t(step.descriptionKey)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Abilities */}
      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head" style={{ alignItems: "center", textAlign: "center" as const }}>
            <div className="section-kicker">{t("home.abilitiesKicker")}</div>
            <h2 className="tile-title">{t("home.abilitiesTitle")}</h2>
            <p className="tile-subtitle">{t("home.abilitiesDescription")}</p>
          </div>
          <div className="utility-grid mt-12">
            {abilities.map((entry) => {
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
