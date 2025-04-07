import { Navbar } from "@/components/navbar";

export default function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-screen h-[94vh]">
      {children}
    </div>
  );
}
