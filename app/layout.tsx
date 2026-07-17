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
import { TabPositionProvider } from "@/context/tabpositioncontext";
import URLBar from "@/components/urlbar";
import HtmlWrapper from "@/components/html-wrapper";
import UpdateBannerClient from "@/components/UpdateBannerClient";
import ChatDockMount from "@/components/ChatDockMount";

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
    { media: "(prefers-color-scheme: light)", color: "#001a0e" },
    { media: "(prefers-color-scheme: dark)", color: "#001a0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="ar" dir="rtl">
      <head />
      <body className={clsx("min-h-screen font-sans antialiased", fontSans.variable)}>
        <Providers themeProps={{ attribute: "class", defaultTheme: "dark" }}>
          <LanguageProvider>
            <TabPositionProvider>
              <HtmlWrapper>
                <div className="relative flex flex-col">
                  <main className="container">
                    <LoadingProvider>
                      <TabProvider>
                        <TabBar />
                        <Navbar />
                        <URLBar />
                        {children}
                        {/* ✅ Bannière mise à jour — s'affiche uniquement si nouvelle version disponible */}
                        <UpdateBannerClient />
                        {/* ✅ Dock Messagerie locale — point de montage unique, piloté par le store global */}
                        <ChatDockMount />
                      </TabProvider>
                    </LoadingProvider>
                  </main>
                </div>
              </HtmlWrapper>
            </TabPositionProvider>
          </LanguageProvider>
        </Providers>
      </body>
    </html>
  );
}
