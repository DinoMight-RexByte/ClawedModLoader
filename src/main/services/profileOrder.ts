import type { OrderMoveKind } from "../../shared/contracts/app";

export function normalizeOrderedModIds(
  selectedModIds: string[],
  orderedModIds: string[]
): string[] {
  const selected = new Set(selectedModIds);
  const normalized: string[] = [];

  for (const modId of orderedModIds) {
    if (selected.has(modId) && !normalized.includes(modId)) {
      normalized.push(modId);
    }
  }

  for (const modId of selectedModIds) {
    if (!normalized.includes(modId)) {
      normalized.push(modId);
    }
  }

  return normalized;
}

export function moveModId(
  orderedModIds: string[],
  modId: string,
  direction: OrderMoveKind
): string[] {
  const nextOrder = [...orderedModIds];
  const currentIndex = nextOrder.indexOf(modId);

  if (currentIndex === -1) {
    return nextOrder;
  }

  const [removed] = nextOrder.splice(currentIndex, 1);
  const targetIndex = getMoveTargetIndex(currentIndex, direction, nextOrder.length);
  nextOrder.splice(targetIndex, 0, removed);
  return nextOrder;
}

export function setModPosition(
  orderedModIds: string[],
  modId: string,
  position: number
): string[] {
  const nextOrder = [...orderedModIds];
  const currentIndex = nextOrder.indexOf(modId);

  if (currentIndex === -1) {
    return nextOrder;
  }

  const [removed] = nextOrder.splice(currentIndex, 1);
  const targetIndex = Math.max(0, Math.min(position - 1, nextOrder.length));
  nextOrder.splice(targetIndex, 0, removed);
  return nextOrder;
}

export function placeModRelative(
  orderedModIds: string[],
  modId: string,
  targetModId: string,
  placement: "before" | "after"
): string[] {
  if (modId === targetModId) {
    return [...orderedModIds];
  }

  const nextOrder = [...orderedModIds];
  const currentIndex = nextOrder.indexOf(modId);
  const targetIndex = nextOrder.indexOf(targetModId);

  if (currentIndex === -1 || targetIndex === -1) {
    return nextOrder;
  }

  const [removed] = nextOrder.splice(currentIndex, 1);
  const adjustedTargetIndex = nextOrder.indexOf(targetModId);
  nextOrder.splice(
    placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1,
    0,
    removed
  );
  return nextOrder;
}

function getMoveTargetIndex(
  currentIndex: number,
  direction: OrderMoveKind,
  lengthAfterRemoval: number
): number {
  if (direction === "top") {
    return 0;
  }
  if (direction === "bottom") {
    return lengthAfterRemoval;
  }
  if (direction === "up") {
    return Math.max(0, currentIndex - 1);
  }
  return Math.min(lengthAfterRemoval, currentIndex + 1);
}
