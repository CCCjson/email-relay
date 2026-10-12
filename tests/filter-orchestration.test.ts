import { beforeEach, describe, expect, it, vi } from "vitest";

// stage2 would really call the API, so it is mocked. stage1 keeps its real
// implementation: the orchestration rule under test is precisely "a Stage 1 hit
// must not call Stage 2".
const stage2Mock = vi.hoisted(() => vi.fn());
vi.mock("../lib/filter/stage2", () => ({ stage2: stage2Mock }));

const { filterMessage, summarizeVerdict } = await import("../lib/filter");

const allow = {
  verdict: "allow" as const,
  categories: [],
  severity: 0,
  reason: "",
  degraded: false,
};

beforeEach(() => {
  stage2Mock.mockReset();
  stage2Mock.mockResolvedValue(allow);
});

describe("two-stage filter orchestration", () => {
  it("does not call Stage 2 when Stage 1 matches (saves money and latency)", async () => {
    const v = await filterMessage("you fucking idiot");

    expect(v.status).toBe("HELD");
    expect(v.stage).toBe(1);
    expect(stage2Mock).not.toHaveBeenCalled();
  });

  it("calls Stage 2 only when Stage 1 misses", async () => {
    await filterMessage("this is late and I am not happy");
    expect(stage2Mock).toHaveBeenCalledOnce();
  });

  it("holds the message and records stage 2 when Stage 2 blocks", async () => {
    stage2Mock.mockResolvedValue({
      verdict: "block",
      categories: ["harassment"],
      severity: 0.8,
      reason: "demeaning language aimed at a person",
      degraded: false,
    });

    const v = await filterMessage("your whole team is beneath contempt");
    expect(v).toMatchObject({ status: "HELD", stage: 2, score: 0.8 });
  });

  it("allows the message with no reason attached when Stage 2 allows", async () => {
    const v = await filterMessage("please send the invoice");
    expect(v).toMatchObject({ status: "VISIBLE", stage: null, reason: null });
  });

  it("allows and marks the verdict when Stage 2 degrades (timeout or missing key)", async () => {
    stage2Mock.mockResolvedValue({ ...allow, degraded: true, reason: "model timed out" });

    const v = await filterMessage("please send the invoice");
    expect(v.status).toBe("VISIBLE");
    expect(v.degraded).toBe(true);
  });

  it("keeps degraded false on a Stage 1 hit - the wordlist needs no external service", async () => {
    const v = await filterMessage("fuck this");
    expect(v.degraded).toBe(false);
  });
});

describe("notification summary", () => {
  it("produces no summary for an allowed message", async () => {
    const v = await filterMessage("all good");
    expect(summarizeVerdict(v)).toBe("");
  });

  it("never includes the matched words in a held message\u2019s summary", async () => {
    const v = await filterMessage("you fucking idiot");
    const summary = summarizeVerdict(v);

    expect(summary).toContain("Stage 1");
    expect(summary).toContain("profanity");
    // The detailed reason stays in the database and the admin view; it must not
    // reach Slack or the notification email
    expect(summary).not.toContain("fucking");
    expect(summary).not.toContain("idiot");
    expect(v.reason).toContain("fucking");
  });

  it("marks a model verdict as Stage 2 in the summary", async () => {
    stage2Mock.mockResolvedValue({
      verdict: "block",
      categories: ["threat"],
      severity: 0.9,
      reason: "contains a threat",
      degraded: false,
    });

    expect(summarizeVerdict(await filterMessage("something"))).toContain("Stage 2");
  });
});
