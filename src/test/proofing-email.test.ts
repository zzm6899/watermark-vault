import { describe, expect, it } from "vitest";
import { buildProofingEmail, proofingEmailSubject, proofingSelectionGuidance } from "@/lib/proofing-email";

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


describe("custom proofing guidance", () => {
  it("uses event overrides, then settings, then built-in defaults", () => {
    const defaults = { "20": "Pick 6 photos.", default: "Pick your favourites." };
    expect(proofingSelectionGuidance(20, defaults, { "20": "Pick 4 photos." })).toBe("Pick 4 photos.");
    expect(proofingSelectionGuidance(20, defaults, { "20": "  " })).toBe("Pick 6 photos.");
    expect(proofingSelectionGuidance(60, defaults)).toBe("Pick your favourites.");
    expect(proofingSelectionGuidance(20, defaults, { default: "Event instructions" })).toBe("Event instructions");
    expect(proofingSelectionGuidance(40, {})).toContain("10\u201315");
  });
  it("replaces the built-in allowance and escapes custom wording", () => {
    const html = buildProofingEmail({ albumTitle: "Portraits", galleryUrl: "https://example.com/gallery", durationMinutes: 20, selectionGuidance: "Choose <6> favourites & submit." });
    expect(html).toContain("Choose &lt;6&gt; favourites &amp; submit.");
    expect(html).not.toContain("5\u20138");
  });
});
