import { describe, expect, it } from "vitest";
import {
  extractMessageIds,
  extractTag,
  extractToken,
  generateToken,
  replyAddress,
  subjectWithTag,
  tagFromToken,
} from "../lib/thread/token";

describe("token generation", () => {
  it("is 16 hex characters", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not repeat (the basis of enumeration resistance)", () => {
    const set = new Set(Array.from({ length: 500 }, generateToken));
    expect(set.size).toBe(500);
  });
});

describe("layer 1: extracting the token from an address", () => {
  const token = "8f3a91c2b7d40e15";

  it("extracts from received_for", () => {
    expect(extractToken([`reply+${token}@inbound.example.com`])).toBe(token);
  });

  it("extracts from an address with a display name", () => {
    expect(extractToken([`Relay <reply+${token}@inbound.example.com>`])).toBe(token);
  });

  it("is case insensitive", () => {
    expect(extractToken([`REPLY+${token.toUpperCase()}@INBOUND.EXAMPLE.COM`])).toBe(token);
  });

  it("takes the first match when several addresses are given", () => {
    expect(
      extractToken(["someone@else.com", `reply+${token}@inbound.example.com`]),
    ).toBe(token);
  });

  it("rejects a token of the wrong length", () => {
    expect(extractToken(["reply+abc@inbound.example.com"])).toBeNull();
  });

  it("returns null for an ordinary address", () => {
    expect(extractToken(["alex@receiver.com", null, undefined])).toBeNull();
  });
});

describe("layer 2: extracting Message-IDs from headers", () => {
  it("parses In-Reply-To", () => {
    expect(extractMessageIds("<abc@mail.example.com>")).toEqual(["abc@mail.example.com"]);
  });

  it("parses several ids out of References", () => {
    expect(extractMessageIds(null, "<a@x.com> <b@x.com> <c@x.com>")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("de-duplicates across both headers", () => {
    expect(extractMessageIds("<a@x.com>", "<a@x.com> <b@x.com>")).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("tolerates clients that omit the angle brackets", () => {
    expect(extractMessageIds("bare-id@x.com")).toEqual(["bare-id@x.com"]);
  });

  it("returns an empty array for empty headers", () => {
    expect(extractMessageIds(null, undefined, "")).toEqual([]);
  });
});

describe("layer 3: the subject tag", () => {
  it("adds the tag", () => {
    expect(subjectWithTag("Project kickoff", "8f3a")).toBe("Project kickoff [#8f3a]");
  });

  it("does not add the tag twice", () => {
    const s = "Project kickoff [#8f3a]";
    expect(subjectWithTag(s, "8f3a")).toBe(s);
  });

  it("extracts the tag from a Re: subject", () => {
    expect(extractTag("Re: Project kickoff [#8f3a]")).toBe("8f3a");
  });

  it("extracts it from a multiply-forwarded subject", () => {
    expect(extractTag("Fwd: Re: Re: Project kickoff [#8f3a] more text")).toBe("8f3a");
  });

  it("returns null when there is no tag", () => {
    expect(extractTag("Re: Project kickoff")).toBeNull();
  });
});

describe("building the reply address", () => {
  it("has the correct plus-addressing shape", () => {
    const token = generateToken();
    expect(replyAddress(token, "inbound.example.com")).toBe(
      `reply+${token}@inbound.example.com`,
    );
  });

  it("uses the first 4 characters of the token as the subject tag", () => {
    expect(tagFromToken("8f3a91c2b7d40e15")).toBe("8f3a");
  });

  it("parses back the address it just built", () => {
    const token = generateToken();
    expect(extractToken([replyAddress(token, "inbound.example.com")])).toBe(token);
  });
});
