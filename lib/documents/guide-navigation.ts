export function nextGuideDestination(hasNextPage: boolean, isLast: boolean, moreFieldsPending = false): "page" | "field" | "waiting" | "complete" {
  if (hasNextPage) return "page";
  if (!isLast) return "field";
  return moreFieldsPending ? "waiting" : "complete";
}
