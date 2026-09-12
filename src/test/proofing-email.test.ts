import { describe, expect, it } from "vitest";
import { buildProofingEmail, proofingEmailSubject } from "@/lib/proofing-email";

describe("proofing email", () => {
  const options = { albumTitle: "Portrait session", clientName: "Alex", galleryUrl: "https://example.com/album/portraits?token=abc&round=1" };

  it.each([[20, "5–8"], [40, "10–15"]])("uses the booked %i-minute session allowance", (duration, range) => {
    const html = buildProofingEmail({ ...options, durationMinutes: Number(duration) });
    expect(html).toContain(`For your ${duration}-minute session, please pick ${range} photos to be edited.`);
    expect(html).toContain("Submit Picks");
  });

  it.each([undefined, 0, 30, 60])("does not invent an allowance for duration %s", durationMinutes => {
    const html = buildProofingEmail({ ...options, durationMinutes });
    expect(html).toContain("Please pick the photos you’d like edited.");
    expect(html).not.toContain("5–8");
    expect(html).not.toContain("10–15");
  });

  it("includes selection instructions and preserves the private gallery link", () => {
    const html = buildProofingEmail(options);
    expect(html).toContain("Hi Alex,");
    expect(html).toContain("Submit Picks");
    expect(html.match(/href="https:\/\/example.com\/album\/portraits\?token=abc&amp;round=1"/g)).toHaveLength(2);
    expect(html).not.toContain("Please submit your selections by");
    expect(proofingEmailSubject(options.albumTitle)).toBe("Choose your photos: Portrait session");
  });

  it("renders notes and deadlines as text rather than injected HTML", () => {
    const html = buildProofingEmail({ ...options, albumTitle: "A & B", clientName: "<Alex>", note: '<img src=x>\nPick 10 & submit.', expiryDate: "Friday <5pm>" });
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Hi &lt;Alex&gt;,");
    expect(html).toContain("&lt;img src=x&gt;<br>Pick 10 &amp; submit.");
    expect(html).toContain("Friday &lt;5pm&gt;");
    expect(html).not.toContain("<img");
  });

  it("rejects unsafe gallery links", () => {
    expect(() => buildProofingEmail({ ...options, galleryUrl: "javascript:alert(1)" })).toThrow("Invalid email link");
  });
});
