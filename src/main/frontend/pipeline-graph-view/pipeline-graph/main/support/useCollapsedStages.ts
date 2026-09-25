import { useCallback, useEffect, useMemo, useState } from "react";

import { Result, StageInfo } from "../PipelineGraphModel.tsx";

/**
 * Returns the stored collapse preference, or null if the user never collapsed
 * or expanded a stage for this job.
 */
function loadFromStorage(key: string): Set<number> | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored) as number[]);
    }
  } catch (err) {
    try {
      // Bad record. Perform best-effort cleanup.
      window.localStorage.removeItem(key);
    } catch {}
  }
  return null;
}

function saveToStorage(key: string, ids: Set<number>) {
  try {
    // An empty list is stored as well: it records that the user expanded
    // everything, which must win over the computed default.
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

function garbageCollectLocalStorage() {
  try {
    window.localStorage.key(0);
  } catch {
    // Local storage access failed, likely due to browser restrictions (expected).
    // Perform this check here so that we can log unexpected errors below.
    return;
  }
  try {
    for (const key of Object.keys(window.localStorage)) {
      // The old key prefix uses a dot as separator.
      if (!key.startsWith("pgv.collapsedStages.")) continue;
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn(
      "Error during garbage collection for collapsed stages in localStorage:",
      err,
    );
  }
}

const STATE_PRIORITY: Record<string, number> = {
  [Result.failure]: 0,
  [Result.unstable]: 1,
  [Result.aborted]: 2,
  [Result.paused]: 3,
  [Result.running]: 4,
  [Result.queued]: 5,
  [Result.not_built]: 6,
  [Result.skipped]: 7,
  [Result.success]: 8,
  [Result.unknown]: 9,
};

function worstState(a: Result, b: Result): Result {
  return (STATE_PRIORITY[a] ?? 9) <= (STATE_PRIORITY[b] ?? 9) ? a : b;
}

function isTransparentState(state: Result): boolean {
  return state === Result.skipped || state === Result.not_built;
}

function aggregateChildState(stage: StageInfo): Result {
  let all = stage.state;
  let nonTransparent: Result | null = isTransparentState(stage.state)
    ? null
    : stage.state;
  for (const child of stage.children) {
    const childState = aggregateChildState(child);
    all = worstState(all, childState);
    if (!isTransparentState(childState)) {
      nonTransparent =
        nonTransparent == null
          ? childState
          : worstState(nonTransparent, childState);
    }
  }
  return nonTransparent ?? all;
}

export function collapseSelectiveStages(
  stages: StageInfo[],
  collapsedIds: Set<number>,
): StageInfo[] {
  return stages.map((stage) => {
    if (stage.children.length === 0) {
      return stage;
    }
    if (collapsedIds.has(stage.id)) {
      return {
        ...stage,
        children: [],
        collapsedChildCount: countLeafStages(stage),
        state: aggregateChildState(stage),
      };
    }
    return {
      ...stage,
      children: collapseSelectiveStages(stage.children, collapsedIds),
    };
  });
}

function countLeafStages(stage: StageInfo): number {
  if (stage.children.length === 0) {
    return 1;
  }
  return stage.children.reduce((sum, child) => sum + countLeafStages(child), 0);
}

export function collectParentStageIds(stages: StageInfo[]): Set<number> {
  const ids = new Set<number>();
  function walk(list: StageInfo[]) {
    for (const stage of list) {
      if (stage.children.length > 0) {
        ids.add(stage.id);
        walk(stage.children);
      }
    }
  }
  walk(stages);
  return ids;
}

function findAncestorIds(stages: StageInfo[], targetId: number): number[] {
  function walk(nodes: StageInfo[]): number[] | null {
    for (const stage of nodes) {
      if (stage.id === targetId) return [];
      const path = walk(stage.children);
      if (path !== null) {
        path.push(stage.id);
        return path;
      }
    }
    return null;
  }
  return walk(stages) ?? [];
}

function isFocusState(state: Result): boolean {
  return (
    state === Result.running ||
    state === Result.paused ||
    state === Result.failure
  );
}

/**
 * The collapsed stages to use when the user has no stored preference for this
 * job: while a stage is running, paused or has failed, collapse every group
 * that does not contain such a stage (or the selected stage). Otherwise,
 * nothing is collapsed.
 */
export function defaultCollapsedStageIds(
  stages: StageInfo[],
  selectedStageId?: number,
): Set<number> {
  const keepOpen = new Set<number>();
  let hasFocus = false;
  function walk(list: StageInfo[], ancestors: number[]) {
    for (const stage of list) {
      if (stage.children.length > 0) {
        walk(stage.children, [...ancestors, stage.id]);
      } else if (isFocusState(stage.state)) {
        hasFocus = true;
        ancestors.forEach((id) => keepOpen.add(id));
      }
    }
  }
  walk(stages, []);
  if (!hasFocus) return new Set();
  if (selectedStageId != null) {
    findAncestorIds(stages, selectedStageId).forEach((id) => keepOpen.add(id));
  }
  return new Set(
    [...collectParentStageIds(stages)].filter((id) => !keepOpen.has(id)),
  );
}

/**
 * Walk the original (uncollapsed) stage tree and return the IDs of any
 * collapsed ancestors of the stage with the given id (plus the target
 * itself if it is collapsed).
 */
function findCollapsedAncestors(
  stages: StageInfo[],
  targetId: number,
  collapsedIds: Set<number>,
): number[] {
  function walk(nodes: StageInfo[]): number[] | null {
    for (const stage of nodes) {
      if (stage.id === targetId) {
        return [];
      }
      if (stage.children.length > 0) {
        const path = walk(stage.children);
        if (path !== null) {
          if (collapsedIds.has(stage.id)) {
            path.push(stage.id);
          }
          return path;
        }
      }
    }
    return null;
  }

  const path = walk(stages);
  if (path === null) return [];
  if (collapsedIds.has(targetId)) {
    path.push(targetId);
  }
  return path;
}

export function useCollapsedStages(
  normalizedParentJobPath: string,
  stages: StageInfo[],
  selectedStageId?: number,
) {
  const storageKey = `pgv.collapsedStages/${normalizedParentJobPath}`;
  // null until the user collapses or expands a stage for this job.
  const [storedStageIds, setStoredStageIds] = useState<Set<number> | null>(() =>
    loadFromStorage(storageKey),
  );
  // Without a stored preference, the default is recomputed on every update so
  // that it follows the running stage. It is never persisted.
  const collapsedStageIds = useMemo(
    () => storedStageIds ?? defaultCollapsedStageIds(stages, selectedStageId),
    [storedStageIds, stages, selectedStageId],
  );

  useEffect(() => {
    garbageCollectLocalStorage();
  }, []);

  const toggleCollapseStage = useCallback(
    (stageId: number) => {
      setStoredStageIds((prev) => {
        // The first toggle turns the current default into a stored preference.
        const next = new Set(prev ?? collapsedStageIds);
        if (next.has(stageId)) {
          next.delete(stageId);
        } else {
          next.add(stageId);
        }
        saveToStorage(storageKey, next);
        return next;
      });
    },
    [storageKey, collapsedStageIds],
  );

  const setCollapsedIds = useCallback(
    (ids: Set<number>) => {
      setStoredStageIds(ids);
      saveToStorage(storageKey, ids);
    },
    [storageKey],
  );

  const collapseAll = useCallback(() => {
    setCollapsedIds(collectParentStageIds(stages));
  }, [stages, setCollapsedIds]);

  const expandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, [setCollapsedIds]);

  const hasCollapsibleStages = useMemo(
    () => collectParentStageIds(stages).size > 0,
    [stages],
  );

  const effectiveStages = useMemo(
    () =>
      collapsedStageIds.size > 0
        ? collapseSelectiveStages(stages, collapsedStageIds)
        : stages,
    [stages, collapsedStageIds],
  );

  // Auto-expand collapsed ancestors when a stage is selected (e.g. via
  // the tree sidebar or ?selected-node= URL param).
  // The computed default already keeps the selected stage visible.
  useEffect(() => {
    if (selectedStageId == null || !storedStageIds?.size) return;
    const ancestors = findCollapsedAncestors(
      stages,
      selectedStageId,
      storedStageIds,
    );
    if (ancestors.length === 0) return;
    setStoredStageIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const id of ancestors) {
        next.delete(id);
      }
      saveToStorage(storageKey, next);
      return next;
    });
  }, [selectedStageId]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to selection changes

  return {
    collapsedStageIds,
    toggleCollapseStage,
    collapseAll,
    expandAll,
    hasCollapsibleStages,
    effectiveStages,
  };
}
