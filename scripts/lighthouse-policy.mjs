export function attemptPasses(scores, thresholds) {
  return Object.entries(thresholds).every(
    ([category, threshold]) => scores[category] >= threshold,
  );
}

export function selectPassingAttempt(attempts, thresholds) {
  return attempts.find((scores) => attemptPasses(scores, thresholds)) ?? null;
}
