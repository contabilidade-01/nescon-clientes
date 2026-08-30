import "@testing-library/jest-dom";

// Este setup é global, mas suítes de backend rodam com `@vitest-environment node`
// (pdfkit, por exemplo, não carrega em jsdom). Lá não existe `window` — sem esta
// guarda, o setup derrubava a suíte inteira antes do primeiro teste.
if (typeof window !== "undefined") {
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
}
