"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function sameOriginPath(anchor: HTMLAnchorElement) {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function StandaloneLinks() {
  const router = useRouter();

  useEffect(() => {
    if (!isStandalone()) return;

    let moved = false;
    let startX = 0;
    let startY = 0;
    let handled = false;

    const go = (anchor: HTMLAnchorElement) => {
      const next = sameOriginPath(anchor);
      if (!next) return false;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) router.push(next);
      return true;
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      moved = false;
      handled = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        moved = true;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (moved) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (!go(anchor)) return;
      handled = true;
      event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (handled || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (!go(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);

  return null;
}
