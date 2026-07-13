export type Score = number;
export type ArtifactColor = "blue" | "red" | "green" | "black" | "yellow" | "unused";

export interface ArtifactState {
  color: ArtifactColor;
  score: Score;
}

export interface ScoreState {
  timeSeconds: number | null;
  notes: string;
  visitors: Score[];
  redTowers: Score[];
  yellowTowers: Score[];
  artifacts: ArtifactState[];
  dirt: Score[];
  bonus: Score[];
  updatedAt: string;
}

export const MAX_SCORE = 230;

export const makeInitialState = (): ScoreState => ({
  timeSeconds: null,
  notes: "",
  visitors: [0, 0, 0, 0],
  redTowers: [0, 0],
  yellowTowers: [0, 0],
  artifacts: Array.from({ length: 4 }, () => ({ color: "unused" as const, score: 0 })),
  dirt: Array.from({ length: 10 }, () => 0),
  bonus: [0, 0, 0],
  updatedAt: new Date().toISOString(),
});

export const sectionScores = (state: ScoreState) => ({
  visitors: sum(state.visitors),
  redTowers: sum(state.redTowers),
  yellowTowers: sum(state.yellowTowers),
  artifacts: sum(state.artifacts.map((item) => item.score)),
  dirt: sum(state.dirt),
  bonus: sum(state.bonus),
});

export const totalScore = (state: ScoreState) =>
  Object.values(sectionScores(state)).reduce((total, score) => total + score, 0);

export const unjudgedCount = (_state: ScoreState) => 0;

export const duplicateArtifactColors = (state: ScoreState) => {
  const colors = state.artifacts.map((item) => item.color).filter((color) => color !== "unused");
  return [...new Set(colors.filter((color, index) => colors.indexOf(color) !== index))];
};

export const isComplete = (state: ScoreState) =>
  duplicateArtifactColors(state).length === 0 &&
  state.artifacts.every((item) => item.color !== "unused");

const sum = (values: Score[]) => values.reduce<number>((total, value) => total + value, 0);
