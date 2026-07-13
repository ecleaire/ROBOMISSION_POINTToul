export type Score = number | null;
export type ArtifactColor = "blue" | "red" | "green" | "black" | "yellow" | "unused";

export interface ArtifactState {
  color: ArtifactColor;
  score: Score;
}

export interface ScoreState {
  teamName: string;
  round: string;
  timeSeconds: number | null;
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
  teamName: "",
  round: "1",
  timeSeconds: null,
  visitors: [null, null, null, null],
  redTowers: [null, null],
  yellowTowers: [null, null],
  artifacts: Array.from({ length: 4 }, () => ({ color: "unused" as const, score: null })),
  dirt: Array.from({ length: 10 }, () => null),
  bonus: [null, null, null],
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

export const unjudgedCount = (state: ScoreState) =>
  [
    ...state.visitors,
    ...state.redTowers,
    ...state.yellowTowers,
    ...state.artifacts.map((item) => item.score),
    ...state.dirt,
    ...state.bonus,
  ].filter((value) => value === null).length;

export const duplicateArtifactColors = (state: ScoreState) => {
  const colors = state.artifacts.map((item) => item.color).filter((color) => color !== "unused");
  return [...new Set(colors.filter((color, index) => colors.indexOf(color) !== index))];
};

export const isComplete = (state: ScoreState) =>
  unjudgedCount(state) === 0 &&
  duplicateArtifactColors(state).length === 0 &&
  state.artifacts.every((item) => item.color !== "unused");

const sum = (values: Score[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
