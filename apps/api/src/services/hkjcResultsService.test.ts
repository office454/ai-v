import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHkjcResultFixturesWithOptions } from "./hkjcResultsService.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHkjcResultFixturesWithOptions", () => {
  it("sends date range values as top-level GraphQL variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { matches: [] }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchHkjcResultFixturesWithOptions({
      startDate: "20260902",
      endDate: "20260909",
      startIndex: 1,
      endIndex: 20
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      variables: {
        startDate: "2026-09-02",
        endDate: "2026-09-09",
        startIndex: 1,
        endIndex: 20,
        teamId: null
      }
    });
  });

  it("paginates date-range results using HKJC's 20-record limit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { matchNumByDate: { total: 21 }, matches: [] }
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { matchNumByDate: { total: 21 }, matches: [] }
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchHkjcResultFixturesWithOptions({ startDate: "2026-09-02", endDate: "2026-09-09" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(firstBody.variables).toMatchObject({ startIndex: 1, endIndex: 20 });
    expect(secondBody.variables).toMatchObject({ startIndex: 21, endIndex: 21 });
  });
});