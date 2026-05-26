import "@testing-library/jest-dom";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Polyfills for Radix UI primitives under jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [];
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;
(globalThis as any).IntersectionObserver = (globalThis as any).IntersectionObserver || IntersectionObserverMock;

if (!(Element.prototype as any).scrollIntoView) {
  (Element.prototype as any).scrollIntoView = () => {};
}
if (!(window as any).HTMLElement.prototype.hasPointerCapture) {
  (window as any).HTMLElement.prototype.hasPointerCapture = () => false;
}
if (!(window as any).HTMLElement.prototype.releasePointerCapture) {
  (window as any).HTMLElement.prototype.releasePointerCapture = () => {};
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
