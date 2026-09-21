import { describe, it, expect } from "vitest";
import { ownerKey } from "@/utils/sessionOwner";

// A session id travels through client logs and proxies, and the stored context
// holds the opener's live OAuth token — so the owner key is what stops a leaked
// session id from being enough to act as someone else.
describe("ownerKey", () => {
  it("identifies an OAuth session by its token subject", () => {
    expect(ownerKey({ subject: "user-1", appId: "key-abc", organizationId: "org-1" }))
      .toBe("sub:user-1");
  });

  it("identifies a legacy x-app-id session by its app id", () => {
    expect(ownerKey({ appId: "key-abc" })).toBe("app:key-abc");
  });

  it("prefers the subject when both are present", () => {
    // The same user may hold different API keys across orgs; the subject is the
    // stable identity, so rotating a key must not orphan a live session.
    expect(ownerKey({ subject: "user-1", appId: "key-1" }))
      .toBe(ownerKey({ subject: "user-1", appId: "key-2" }));
  });

  it("never collides across the two credential shapes", () => {
    // Without the namespace prefixes, a legacy appId equal to someone's user id
    // would resolve to the same owner.
    expect(ownerKey({ subject: "shared-value", appId: "x" }))
      .not.toBe(ownerKey({ appId: "shared-value" }));
  });

  it("separates two users holding the same app id", () => {
    expect(ownerKey({ subject: "user-1", appId: "shared-key" }))
      .not.toBe(ownerKey({ subject: "user-2", appId: "shared-key" }));
  });
});
