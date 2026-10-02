import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin photo workflow UI contracts", () => {
  const adminSource = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");

  it("keeps photo work in the mobile primary navigation", () => {
    expect(adminSource).toContain('const MOBILE_PRIMARY_TABS: Tab[] = ["dashboard", "bookings", "albums", "photos"]');
    expect(adminSource).toContain("MOBILE_PRIMARY_TABS.includes(tab.id)");
    expect(adminSource).toContain("MOBILE_PRIMARY_TABS.includes(activeTab)");
    expect(adminSource).toContain('group: "Business", label: "Finance"');
  });

  it("keeps the photo selection bar clear of the fixed mobile header", () => {
    expect(adminSource).toContain("sticky top-[calc(env(safe-area-inset-top,_0px)_+_3rem)] lg:top-0");
    expect(adminSource).toContain('min-h-screen app-shell overflow-x-clip');
    expect(adminSource).toContain('min-w-0 overflow-x-clip lg:ml-60');
  });

  it("makes photo selection and common tile actions available to keyboard and touch users", () => {
    expect(adminSource).toContain('aria-label={`${selectedIds.has(p.id) ? "Deselect" : "Select"} ${p.title}`}');
    expect(adminSource).toContain('aria-label={`${(p as any).starred ? "Unstar" : "Star"} ${p.title}`}');
    expect(adminSource).toContain('aria-label={`View ${p.title} full size`}');
    expect(adminSource).toContain('aria-label={`AI enhance ${p.title}`}');
    expect(adminSource).toContain('aria-label={`Remove ${p.title}`}');
    expect(adminSource).toContain("opacity-100 sm:opacity-0 sm:group-hover:opacity-100");
    expect(adminSource).toContain("focus-visible:opacity-100");
  });

  it("selects or clears only the currently visible photo set", () => {
    expect(adminSource).toContain("const allVisiblePhotosSelected = visiblePhotoIds.length > 0 && visiblePhotoIds.every(id => selectedIds.has(id))");
    expect(adminSource).toContain("visiblePhotoIds.forEach(id => allVisiblePhotosSelected ? next.delete(id) : next.add(id))");
  });
});
