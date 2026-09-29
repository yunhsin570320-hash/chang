import { ScrollViewStyleReset } from 'expo-router/html';

export default function RootHTML({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Open Graph / Facebook / LINE / WhatsApp */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="暗標競標會 — 密封競標平台" />
        <meta property="og:description" content="密封出價・公平競標・真實交易。誠邀測試會員加入，體驗全功能競標平台。" />
        <meta property="og:image" content="https://mobile-blind-auction-t07x.bolt.host/promo-og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="zh_TW" />
        <meta property="og:site_name" content="暗標競標會" />

        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="暗標競標會 — 密封競標平台" />
        <meta name="twitter:description" content="密封出價・公平競標・真實交易。誠邀測試會員加入。" />
        <meta name="twitter:image" content="https://mobile-blind-auction-t07x.bolt.host/promo-og.png" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
