import { act, renderHook } from "@testing-library/react";

import { Result, StageInfo } from "../PipelineGraphModel.tsx";
import {
  collapseSelectiveStages,
  collectParentStageIds,
  defaultCollapsedStageIds,
  useCollapsedStages,
} from "./useCollapsedStages.ts";

describe("collapseSelectiveStages", () => {
  it("should leave leaf stages unchanged", () => {
    const stages: StageInfo[] = [
      {
        name: "Build",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set([1]));
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(0);
    expect(result[0].collapsedChildCount).toBeUndefined();
  });

  it("should collapse a named parent stage", () => {
    const stages: StageInfo[] = [
      {
        name: "Test",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Unit",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [],
          } as unknown as StageInfo,
          {
            name: "Integration",
            state: Result.failure,
            id: 3,
            type: "STAGE",
            children: [],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set([1]));
    expect(result[0].children).toHaveLength(0);
    expect(result[0].collapsedChildCount).toBe(2);
    expect(result[0].state).toBe(Result.failure);
  });

  it("should not collapse stages not in the set", () => {
    const stages: StageInfo[] = [
      {
        name: "Test",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Unit",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set([999]));
    expect(result[0].children).toHaveLength(1);
    expect(result[0].collapsedChildCount).toBeUndefined();
  });

  it("should collapse recursively within non-collapsed parents", () => {
    const stages: StageInfo[] = [
      {
        name: "Outer",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Inner",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [
              {
                name: "Leaf",
                state: Result.success,
                id: 3,
                type: "STAGE",
                children: [],
              } as unknown as StageInfo,
            ],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set([2]));
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].children).toHaveLength(0);
    expect(result[0].children[0].collapsedChildCount).toBe(1);
  });

  it("should count leaf stages through deep nesting", () => {
    const stages: StageInfo[] = [
      {
        name: "Root",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Mid",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [
              {
                name: "Leaf1",
                state: Result.success,
                id: 3,
                type: "STAGE",
                children: [],
              } as unknown as StageInfo,
              {
                name: "Leaf2",
                state: Result.success,
                id: 4,
                type: "STAGE",
                children: [],
              } as unknown as StageInfo,
            ],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set([1]));
    expect(result[0].collapsedChildCount).toBe(2);
  });

  it("should handle empty collapsedNames (no-op)", () => {
    const stages: StageInfo[] = [
      {
        name: "Build",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Sub",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collapseSelectiveStages(stages, new Set());
    expect(result[0].children).toHaveLength(1);
  });
});

describe("collectParentStageIds", () => {
  it("should return empty set for leaf-only stages", () => {
    const stages: StageInfo[] = [
      {
        name: "A",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [],
      } as unknown as StageInfo,
      {
        name: "B",
        state: Result.success,
        id: 2,
        type: "STAGE",
        children: [],
      } as unknown as StageInfo,
    ];
    expect(collectParentStageIds(stages).size).toBe(0);
  });

  it("should collect top-level parent stage ids", () => {
    const stages: StageInfo[] = [
      {
        name: "Parent",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Child",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
      {
        name: "Leaf",
        state: Result.success,
        id: 3,
        type: "STAGE",
        children: [],
      } as unknown as StageInfo,
    ];
    const result = collectParentStageIds(stages);
    expect(result).toEqual(new Set([1]));
  });

  it("should collect nested parent stage ids", () => {
    const stages: StageInfo[] = [
      {
        name: "Root",
        state: Result.success,
        id: 1,
        type: "STAGE",
        children: [
          {
            name: "Mid",
            state: Result.success,
            id: 2,
            type: "STAGE",
            children: [
              {
                name: "Leaf",
                state: Result.success,
                id: 3,
                type: "STAGE",
                children: [],
              } as unknown as StageInfo,
            ],
          } as unknown as StageInfo,
        ],
      } as unknown as StageInfo,
    ];
    const result = collectParentStageIds(stages);
    expect(result).toEqual(new Set([1, 2]));
  });
});

function leaf(id: number, state: Result = Result.success): StageInfo {
  return {
    name: `Stage ${id}`,
    state,
    id,
    type: "STAGE",
    children: [],
  } as unknown as StageInfo;
}

function group(id: number, children: StageInfo[]): StageInfo {
  return {
    name: `Group ${id}`,
    state: Result.success,
    id,
    type: "STAGE",
    children,
  } as unknown as StageInfo;
}

// Build, Static (parallel), Unit, Quality (parallel), Deploy
function pipeline(states: Record<number, Result> = {}): StageInfo[] {
  const s = (id: number) => leaf(id, states[id]);
  return [
    s(1),
    group(10, [s(11), s(12), s(13)]),
    s(2),
    group(20, [s(21), group(22, [s(23), s(24)])]),
    s(3),
  ];
}

describe("defaultCollapsedStageIds", () => {
  it("collapses the groups that do not contain the running stage", () => {
    expect(defaultCollapsedStageIds(pipeline({ 12: Result.running }))).toEqual(
      new Set([20, 22]),
    );
  });

  it("keeps all ancestors of a nested running stage open", () => {
    expect(defaultCollapsedStageIds(pipeline({ 24: Result.running }))).toEqual(
      new Set([10]),
    );
  });

  it("keeps the groups with failed and paused stages open", () => {
    expect(
      defaultCollapsedStageIds(
        pipeline({ 13: Result.failure, 23: Result.paused }),
      ),
    ).toEqual(new Set());
  });

  it("keeps the group of the selected stage open", () => {
    expect(
      defaultCollapsedStageIds(pipeline({ 3: Result.running }), 11),
    ).toEqual(new Set([20, 22]));
  });

  it("collapses nothing for a successful run", () => {
    expect(defaultCollapsedStageIds(pipeline())).toEqual(new Set());
  });
});

describe("useCollapsedStages", () => {
  const JOB = "job/test";
  const KEY = `pgv.collapsedStages/${JOB}`;

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("collapses by default without storing it", () => {
    const { result } = renderHook(() =>
      useCollapsedStages(JOB, pipeline({ 2: Result.running })),
    );

    expect(result.current.collapsedStageIds).toEqual(new Set([10, 20, 22]));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("follows the running stage as the run progresses", () => {
    const { result, rerender } = renderHook(
      ({ stages }) => useCollapsedStages(JOB, stages),
      { initialProps: { stages: pipeline({ 11: Result.running }) } },
    );
    expect(result.current.collapsedStageIds).toEqual(new Set([20, 22]));

    rerender({ stages: pipeline({ 21: Result.running }) });
    expect(result.current.collapsedStageIds).toEqual(new Set([10, 22]));
  });

  it("does not collapse a successful run", () => {
    const { result } = renderHook(() => useCollapsedStages(JOB, pipeline()));

    expect(result.current.collapsedStageIds).toEqual(new Set());
  });

  it("honours a stored preference", () => {
    window.localStorage.setItem(KEY, JSON.stringify([10]));
    const { result } = renderHook(() =>
      useCollapsedStages(JOB, pipeline({ 2: Result.running })),
    );

    expect(result.current.collapsedStageIds).toEqual(new Set([10]));
  });

  it("honours a stored preference to expand everything", () => {
    const first = renderHook(() =>
      useCollapsedStages(JOB, pipeline({ 2: Result.running })),
    );
    act(() => first.result.current.expandAll());
    first.unmount();

    const second = renderHook(() =>
      useCollapsedStages(JOB, pipeline({ 2: Result.running })),
    );
    expect(second.result.current.collapsedStageIds).toEqual(new Set());
  });

  it("stores the default plus the toggle on the first toggle", () => {
    const { result } = renderHook(() =>
      useCollapsedStages(JOB, pipeline({ 2: Result.running })),
    );
    act(() => result.current.toggleCollapseStage(20));

    expect(result.current.collapsedStageIds).toEqual(new Set([10, 22]));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual([10, 22]);
  });
});
