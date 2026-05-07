import { describe, expect, it } from "vitest";
import { stripTenantQueryFromSrc } from "@/lib/api";

describe("tenant album persistence helpers", () => {
  it("removes tenant routing params from upload URLs before save", () => {
    expect(stripTenantQueryFromSrc("/uploads/photo.jpg?tenant=demo", "demo")).toBe("/uploads/photo.jpg");
    expect(stripTenantQueryFromSrc("/uploads/photo.jpg?size=thumb&tenant=demo", "demo")).toBe("/uploads/photo.jpg?size=thumb");
    expect(stripTenantQueryFromSrc("/uploads/photo.jpg?tenant=demo&wm=0", "demo")).toBe("/uploads/photo.jpg?wm=0");
  });

  it("leaves unrelated sources and other tenant routes unchanged", () => {
    expect(stripTenantQueryFromSrc("data:image/jpeg;base64,abc?tenant=demo", "demo")).toBe("data:image/jpeg;base64,abc?tenant=demo");
    expect(stripTenantQueryFromSrc("/uploads/photo.jpg?tenant=other", "demo")).toBe("/uploads/photo.jpg?tenant=other");
    expect(stripTenantQueryFromSrc("/uploads/photo.jpg?size=medium", "demo")).toBe("/uploads/photo.jpg?size=medium");
  });
});
