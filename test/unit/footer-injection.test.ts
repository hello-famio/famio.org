/**
 * Unit tests for footer injection utility functions.
 * Run via: bun run test:staging  (uses vitest.integration.config.ts, node env)
 */

import { describe, it, expect } from "vitest";
import { injectTextFooter, injectHtmlFooter } from "../../src/services/email";

const NAME = "smiths";
const DOMAIN = "famio.org";

describe("injectTextFooter", () => {
  it("appends footer after double newline", () => {
    const result = injectTextFooter("Hello family.", NAME, DOMAIN);
    expect(result).toBe("Hello family.\n\n--\nSent via smiths@famio.org · famio.org");
  });

  it("preserves existing content exactly", () => {
    const text = "Line 1\nLine 2\n\nParagraph 2.";
    const result = injectTextFooter(text, NAME, DOMAIN);
    expect(result?.startsWith(text)).toBe(true);
  });

  it("returns undefined when input is null", () => {
    expect(injectTextFooter(null, NAME, DOMAIN)).toBeUndefined();
  });

  it("returns undefined when input is undefined", () => {
    expect(injectTextFooter(undefined, NAME, DOMAIN)).toBeUndefined();
  });

  it("returns undefined when input is empty string", () => {
    expect(injectTextFooter("", NAME, DOMAIN)).toBeUndefined();
  });

  it("includes addressName and domain in footer", () => {
    const result = injectTextFooter("hi", "jones", "famio.org");
    expect(result).toContain("jones@famio.org");
  });
});

describe("injectHtmlFooter", () => {
  it("inserts footer div before </body>", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const result = injectHtmlFooter(html, NAME, DOMAIN);
    expect(result).toContain("</div></body>");
    expect(result?.indexOf("famio.org")).toBeLessThan(result?.indexOf("</body>") ?? Infinity);
  });

  it("appends footer at end when no </body> tag present", () => {
    const html = "<p>Hello</p>";
    const result = injectHtmlFooter(html, NAME, DOMAIN);
    expect(result?.startsWith("<p>Hello</p>")).toBe(true);
    expect(result).toContain("famio.org");
  });

  it("preserves content before </body>", () => {
    const html = "<html><body><p>Content</p></body></html>";
    const result = injectHtmlFooter(html, NAME, DOMAIN);
    expect(result).toContain("<p>Content</p>");
  });

  it("includes addressName@domain in footer", () => {
    const result = injectHtmlFooter("<body></body>", "jones", "famio.org");
    expect(result).toContain("jones@famio.org");
  });

  it("includes famio.org signup link in footer", () => {
    const result = injectHtmlFooter("<body><p>Hi</p></body>", NAME, DOMAIN);
    expect(result).toContain("https://famio.org");
  });

  it("returns undefined when input is null", () => {
    expect(injectHtmlFooter(null, NAME, DOMAIN)).toBeUndefined();
  });

  it("returns undefined when input is undefined", () => {
    expect(injectHtmlFooter(undefined, NAME, DOMAIN)).toBeUndefined();
  });

  it("returns undefined when input is empty string", () => {
    expect(injectHtmlFooter("", NAME, DOMAIN)).toBeUndefined();
  });

  it("only replaces the first </body> occurrence (defensive)", () => {
    // Malformed HTML with two </body> tags — should only inject once
    const html = "<body>text</body></body>";
    const result = injectHtmlFooter(html, NAME, DOMAIN) ?? "";
    const count = (result.match(/<\/body>/g) ?? []).length;
    expect(count).toBe(2); // replaced first, second remains
  });
});
