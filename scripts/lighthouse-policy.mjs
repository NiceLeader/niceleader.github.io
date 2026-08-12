export function attemptPasses(scores, thresholds) {
  return Object.entries(thresholds).every(
    ([category, threshold]) => scores[category] >= threshold,
  );
}
