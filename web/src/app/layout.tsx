import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import { SiteHeader } from "@/components/site-header";
import { APP_NAME } from "@/lib/constants";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Families abroad lock tuition in USDG; a licensed partner pays the university in lira; the university signs the receipt on Solana.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          <main className="shell main">{children}</main>
          <footer className="shell site-footer">
            Solana devnet demo. Test tokens only; no real lira moves on-chain.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
