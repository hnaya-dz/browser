import URLBar from "@/components/urlbar";

export default function BrowserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-screen">
      <URLBar />
      {children}
    </div >
  );
}
