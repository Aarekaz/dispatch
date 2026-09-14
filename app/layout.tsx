import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";

import { GlobalBanner } from "@/components/global-banner";
import { Providers } from "@/components/providers";
import { getToken } from "@/lib/auth-server";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistHeading = Geist({ subsets: ["latin"], variable: "--font-heading" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["300", "400", "500"],
  display: "swap",
});

function getMetadataBase(): URL {
  const candidate =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "http://localhost:3000";

  try {
    return new URL(candidate);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: "Dispatch",
  description: "Self-hosted control plane for AI agents.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Dispatch",
    description: "Self-hosted control plane for AI agents.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = await getToken();
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cn(
        geistSans.variable,
        geistHeading.variable,
        geistMono.variable,
        newsreader.variable,
      )}
    >
      <body
        suppressHydrationWarning
        className="flex min-h-dvh flex-col overflow-x-hidden bg-background"
      >
        {process.env.NODE_ENV === "development" && (
          <script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            async
          />
        )}
        <Providers initialToken={token}>
          <GlobalBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
