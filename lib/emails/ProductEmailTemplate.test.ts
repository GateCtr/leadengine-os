/// <reference types="vite/client" />
import { describe, test, expect } from "vitest";
import {
  buildProductEmailHtml,
  buildProductEmailPreview,
  renderProductEmail,
  contrastTextColor,
  escapeHtml,
  type ProductEmailTemplateProps,
} from "./ProductEmailTemplate";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const piksendProps: ProductEmailTemplateProps = {
  product: {
    productName: "Piksend",
    brandColor: "#FF6B35",
    logoUrl: "https://piksend.com/logo.png",
    senderEmail: "hello@piksend.com",
  },
  content: {
    subject: "Discover Piksend",
    body: "<p>Hello, check out our product!</p>",
    unsubscribeUrl: "https://leadengine.io/unsubscribe?id=abc123",
  },
};

const gatectrProps: ProductEmailTemplateProps = {
  product: {
    productName: "GateCtr",
    brandColor: "#2563EB",
    logoUrl: "https://gatectr.com/logo.png",
    senderEmail: "hello@gatectr.com",
  },
  content: {
    subject: "Optimize your LLM costs",
    body: "<p>GateCtr can help you save on API costs.</p>",
    unsubscribeUrl: "https://leadengine.io/unsubscribe?id=def456",
  },
};

// ─── contrastTextColor ───────────────────────────────────────────────────────

describe("contrastTextColor", () => {
  test("returns white for dark colors", () => {
    expect(contrastTextColor("#000000")).toBe("#ffffff");
    expect(contrastTextColor("#1a1a2e")).toBe("#ffffff");
    expect(contrastTextColor("#2563EB")).toBe("#ffffff");
  });

  test("returns dark for light colors", () => {
    expect(contrastTextColor("#ffffff")).toBe("#1a1a1a");
    expect(contrastTextColor("#f0f0f0")).toBe("#1a1a1a");
    expect(contrastTextColor("#FFFF00")).toBe("#1a1a1a");
  });

  test("returns white for invalid hex", () => {
    expect(contrastTextColor("#abc")).toBe("#ffffff");
    expect(contrastTextColor("invalid")).toBe("#ffffff");
  });
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  test("escapes HTML special characters", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
    );
  });

  test("escapes ampersands and quotes", () => {
    expect(escapeHtml('A & B "C"')).toBe("A &amp; B &quot;C&quot;");
  });

  test("passes through safe strings unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

// ─── buildProductEmailHtml ───────────────────────────────────────────────────

describe("buildProductEmailHtml", () => {
  test("produces a complete HTML document", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  test("includes the product logo", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("https://piksend.com/logo.png");
    expect(html).toContain('alt="Piksend"');
  });

  test("includes the brand color in the accent bar", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("background-color:#FF6B35");
  });

  test("includes the message body content", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("<p>Hello, check out our product!</p>");
  });

  test("includes the unsubscribe link in the footer", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("https://leadengine.io/unsubscribe?id=abc123");
    expect(html).toContain("Se désinscrire");
  });

  test("includes the product name in the footer", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("Piksend");
  });

  test("includes the sender email in the footer", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("hello@piksend.com");
  });

  test("includes the subject in the title tag", () => {
    const html = buildProductEmailHtml(piksendProps);
    expect(html).toContain("<title>Discover Piksend</title>");
  });

  test("works with different product configs", () => {
    const html = buildProductEmailHtml(gatectrProps);
    expect(html).toContain("https://gatectr.com/logo.png");
    expect(html).toContain("background-color:#2563EB");
    expect(html).toContain("GateCtr");
    expect(html).toContain("hello@gatectr.com");
    expect(html).toContain("https://leadengine.io/unsubscribe?id=def456");
  });

  test("escapes HTML in product name to prevent XSS", () => {
    const xssProps: ProductEmailTemplateProps = {
      product: {
        ...piksendProps.product,
        productName: '<script>alert("xss")</script>',
      },
      content: piksendProps.content,
    };
    const html = buildProductEmailHtml(xssProps);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── buildProductEmailPreview ────────────────────────────────────────────────

describe("buildProductEmailPreview", () => {
  test("produces a preview without full HTML document wrapper", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).not.toContain("<!DOCTYPE html>");
    expect(preview).not.toContain("<html");
    expect(preview).not.toContain("</html>");
  });

  test("includes the product logo", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).toContain("https://piksend.com/logo.png");
  });

  test("includes the brand color accent bar", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).toContain("background-color:#FF6B35");
  });

  test("includes the message body", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).toContain("<p>Hello, check out our product!</p>");
  });

  test("includes the unsubscribe link", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).toContain("https://leadengine.io/unsubscribe?id=abc123");
    expect(preview).toContain("Se désinscrire");
  });

  test("includes product name and sender email in footer", () => {
    const preview = buildProductEmailPreview(piksendProps);
    expect(preview).toContain("Piksend");
    expect(preview).toContain("hello@piksend.com");
  });
});

// ─── renderProductEmail ──────────────────────────────────────────────────────

describe("renderProductEmail", () => {
  test("returns the same output as buildProductEmailHtml", () => {
    const rendered = renderProductEmail(piksendProps);
    const built = buildProductEmailHtml(piksendProps);
    expect(rendered).toBe(built);
  });

  test("returns a non-empty HTML string", () => {
    const rendered = renderProductEmail(piksendProps);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toContain("<!DOCTYPE html>");
  });
});
