import { describe, expect, it } from "vitest";
import { stage1 } from "../lib/filter/stage1";
import { normalize } from "../lib/filter/normalize";

const hits = (s: string) => stage1(s).hit;

describe("Stage 1 - plain profanity", () => {
  it.each([
    "what the fuck is this",
    "this is complete bullshit",
    "you are an asshole",
    "stop being a bitch about it",
  ])("blocks %s", (text) => {
    expect(hits(text)).toBe(true);
  });
});

describe("Stage 1 - obfuscated variants", () => {
  it.each([
    ["censored", "what the f*ck"],
    ["censored with #", "this is sh#t"],
    ["leet 1", "what the sh1t"],
    ["leet 0", "f0ck this"],
    ["leet @", "you @sshole"],
    ["repeated characters", "fuuuuck this"],
    ["space separated", "f u c k this"],
    ["dot separated", "f.u.c.k this"],
    ["hyphen separated", "f-u-c-k this"],
    ["uppercase", "FUCK THIS"],
    ["plural", "these fucks"],
  ])("blocks %s: %s", (_label, text) => {
    expect(hits(text)).toBe(true);
  });
});

describe("Stage 1 - Scunthorpe checks (must never false-positive)", () => {
  it.each([
    "this is a classic mistake",
    "please send the assessment by Friday",
    "the analysis looks solid",
    "I need to assess the situation",
    "we booked a hotel in Scunthorpe",
    "the cockpit door was locked",
    "let's have a cocktail after",
    "she is a therapist",
    "he works as a data analyst",
    "the class starts at nine",
    "grape juice",
  ])("allows %s", (text) => {
    expect(hits(text)).toBe(false);
  });
});

describe("Stage 1 - legitimate negative sentiment must pass", () => {
  it.each([
    "this is late, I'm not happy",
    "I am very disappointed with the delay",
    "this is unacceptable, please fix it today",
    "we are cancelling the contract",
    "your team has missed three deadlines",
    "I want a refund immediately",
  ])("allows %s", (text) => {
    expect(hits(text)).toBe(false);
  });
});

describe("Stage 1 - categories and scoring", () => {
  it("categorises a slur as slur, with the highest severity", () => {
    const r = stage1("you retarded fool");
    expect(r.hit).toBe(true);
    expect(r.categories).toContain("slur");
    expect(r.score).toBeGreaterThanOrEqual(0.85);
  });

  it("categorises a threatening phrase as threat", () => {
    const r = stage1("I will kill you");
    expect(r.categories).toContain("threat");
  });

  it("records the same word only once", () => {
    const r = stage1("fuck fuck fuck");
    expect(r.matches.filter((m) => m.word === "fuck")).toHaveLength(1);
  });

  it("returns an empty result for clean text", () => {
    const r = stage1("Thanks, sounds good.");
    expect(r).toMatchObject({ hit: false, matches: [], categories: [], score: 0 });
  });
});

describe("normalize", () => {
  it("folds runs of three or more but keeps a run of two", () => {
    expect(normalize("fuuuck").primary).toContain("fuck");
    // The double s in assess must not fold to a single s, or it becomes asses
    expect(normalize("assess").primary).toBe("assess");
  });

  it("removes accents", () => {
    expect(normalize("fúck").primary).toContain("fuck");
  });

  it("normalises full-width characters", () => {
    expect(normalize("ｆｕｃｋ").primary).toContain("fuck");
  });
});
