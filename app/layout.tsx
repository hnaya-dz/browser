import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "./providers";
import { siteConfig } from "@/config/site";
import { fontSans } from "@/config/fonts";
import { Navbar } from "@/components/navbar";
import TabBar from "@/components/tabbar";
import { TabProvider } from "@/context/tabcontext";
import { LoadingProvider } from "@/context/loadingcontext";
import { LanguageProvider } from "@/context/langcontext";
import URLBar from "@/components/urlbar";
import HtmlWrapper from "@/components/html-wrapper";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="ar" dir="rtl">
      <head />
      <body className={clsx("min-h-screen bg-background font-sans antialiased", fontSans.variable)}>
        <Providers themeProps={{ attribute: "class", defaultTheme: "dark" }}>
          <LanguageProvider>
            <HtmlWrapper>
              <div className="relative flex flex-col">
                <main className="container">
                  <LoadingProvider>
                    <TabProvider>
                      <TabBar />
                      <Navbar />
                      <URLBar />
                      {children}
                    </TabProvider>
                  </LoadingProvider>
                </main>
              </div>
            </HtmlWrapper>
          </LanguageProvider>
        </Providers>
      </body>
    </html>
  );
}
