import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { Providers } from "@/app/providers";

import "./globals.css";

const navigation = [
  { href: "/agent" as Route, label: "Agent" },
  { href: "/dashboard" as Route, label: "指标" },
  { href: "/memories" as Route, label: "记忆" },
  { href: "/runs" as Route, label: "轨迹" },
  { href: "/governance" as Route, label: "治理" },
  { href: "/docs" as Route, label: "文档" }
];

export const metadata: Metadata = {
  title: "Continuum · Observatory",
  description: "Agent memory runtime observability dashboard."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <div className="min-h-screen bg-background text-foreground">
            <header className="global-nav">
              <div className="global-nav-inner">
                <Link href={"/" as Route} className="global-nav-link font-semibold">
                  Continuum
                </Link>
                <nav className="global-nav-links" aria-label="全局导航">
                  {navigation.map((item) => (
                    <Link key={item.href} href={item.href} className="global-nav-link">
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </header>

            <main className="page-shell">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
