import type { Metadata } from "next";
import type { ResolvingMetadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { AppLocaleSwitch } from "@/components/app-locale-switch";
import { Providers } from "@/app/providers";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/messages";

import "./globals.css";

const navigation = [
  { href: "/agent" as Route, labelKey: "layout.nav.agent" },
  { href: "/dashboard" as Route, labelKey: "layout.nav.dashboard" },
  { href: "/memories" as Route, labelKey: "layout.nav.memories" },
  { href: "/runs" as Route, labelKey: "layout.nav.runs" },
  { href: "/governance" as Route, labelKey: "layout.nav.governance" },
  { href: "/docs/configuration" as Route, labelKey: "layout.nav.docs" }
];

export async function generateMetadata(_props: unknown, _parent: ResolvingMetadata): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  return {
    title: t("layout.metadataTitle"),
    description: t("layout.metadataDescription")
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  return (
    <html lang={locale}>
      <body>
        <Providers defaultLocale={locale}>
          <div className="min-h-screen bg-background text-foreground">
            <header className="global-nav">
              <div className="global-nav-inner">
                <Link href={"/" as Route} className="global-nav-link font-semibold">
                  Continuum
                </Link>
                <nav className="global-nav-links" aria-label={t("layout.navAria")}>
                  {navigation.map((item) => (
                    <Link key={item.href} href={item.href} className="global-nav-link">
                      {t(item.labelKey)}
                    </Link>
                  ))}
                </nav>
                <div className="global-nav-actions">
                  <AppLocaleSwitch />
                </div>
              </div>
            </header>

            <main className="page-shell">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
