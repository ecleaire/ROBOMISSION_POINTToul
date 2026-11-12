export interface ScoreActivityInput {
  scores: readonly number[];
  timeSeconds: number | null;
  text: string;
  hasExtra?: boolean;
}

export function hasScoreActivity(input: ScoreActivityInput) {
  return input.scores.some((score) => score !== 0)
    || input.timeSeconds !== null
    || input.text.trim().length > 0
    || Boolean(input.hasExtra);
}
