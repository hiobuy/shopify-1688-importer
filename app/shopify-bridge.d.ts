import type {
  DetailedHTMLProps,
  HTMLAttributes,
  AnchorHTMLAttributes,
} from "react";
// Minimal DOM typings for the App Bridge navigation elements used here.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-link": DetailedHTMLProps<
        AnchorHTMLAttributes<HTMLAnchorElement>,
        HTMLAnchorElement
      >;
    }
  }
}
