import { describe, expect, it } from "vitest";
import { buildClientEmail, buildGalleryStatusEmail } from "@/lib/client-email";

describe("client email documents", () => {
  it("escapes edited messages and keeps paragraph breaks", () => {
    const html = buildClientEmail({ title: "A & B", body: "Hi <Alex>,\n\nFirst line\nSecond line" });
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Hi &lt;Alex&gt;,");
    expect(html).toContain("First line<br>Second line");
    expect(html).toContain('class="email-shell" data-photoflow-email="true"');
    expect(html).not.toContain("<Alex>");
  });
  it("preserves private tokens in both action and fallback links", () => {
    const html = buildGalleryStatusEmail({ title: "Portraits", clientName: "Alex" }, "https://photos.example/gallery/portraits#token=secret", "delivered", true);
    expect(html.match(/href="https:\/\/photos.example\/gallery\/portraits#token=secret"/g)).toHaveLength(2);
    expect(html).toContain("at no charge");
    expect(buildGalleryStatusEmail({ title: "Portraits" }, "https://photos.example/gallery/portraits", "delivered")).not.toContain("at no charge");
  });
});
