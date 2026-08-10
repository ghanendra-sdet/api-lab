import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; the app's theme detection reads it once at
// store-creation time, so tests need a minimal stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

