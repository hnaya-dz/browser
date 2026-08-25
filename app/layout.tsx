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
import ExternalOpenNotice from "@/components/ExternalOpenNotice";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import TutorialBootstrap from "@/components/TutorialBootstrap";

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
      <head>
        {/* ⚠️ POSER LA TEINTE AVANT LE PREMIER RENDU.
            Les teintes (émeraude, gris, blanc) sont portées par data-tint,
            hors de next-themes — voir components/theme-switch.tsx. Or
            next-themes applique SA classe par un script en ligne exécuté
            avant que la page ne s'affiche, tandis qu'un useEffect ne
            s'exécute qu'APRÈS le premier rendu : le fond du thème de base
            s'affichait donc une fraction de seconde avant de sauter à la
            teinte, à chaque ouverture. Ce script fait pour data-tint ce que
            next-themes fait pour la classe.

            Il est volontairement minuscule et enfermé dans un try : il
            s'exécute avant tout le reste, une erreur ici bloquerait
            l'affichage de la page entière. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('hnaya-theme-tint');" +
              "if(t==='emeraude'||t==='gris'||t==='blanc')" +
              "document.documentElement.setAttribute('data-tint',t);}catch(e){}",
          }}
        />
      </head>
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
                        {/* ✅ Bandeau « ouvert dans le navigateur système » (connexion Google).
                            Monté ICI et non dans la barre d'adresse : celle-ci se remonte au
                            changement d'onglet, ce qui effaçait le bandeau avant affichage. */}
                        <ExternalOpenNotice />
                        {/* ✅ Mode tutoriel interactif (trilingue, peut s'activer via l'icône Livre) */}
                        <TutorialOverlay />
                        {/* ✅ Bootstrap du tutoriel au premier lancement (localStorage) */}
                        <TutorialBootstrap />
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
