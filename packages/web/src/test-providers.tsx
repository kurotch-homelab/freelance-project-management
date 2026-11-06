import { FormaProvider } from "@kurotch-homelab/forma-react";
import type { PropsWithChildren } from "react";

// jsdom にないブラウザ API だけを補う。実ブラウザの実装は置き換えない。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const events = new EventTarget();
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      };
    },
  });
}

export function TestProviders({ children }: PropsWithChildren) {
  return <FormaProvider locale="ja" theme="light" motion="reduce">{children}</FormaProvider>;
}
