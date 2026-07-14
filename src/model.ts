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

const artifactColors = new Set<ArtifactColor>(["blue", "red", "green", "black", "yellow", "unused"]);

export const sanitizeScoreState = (value: unknown): ScoreState => {
  const initial = makeInitialState();
  if (!value || typeof value !== "object") return initial;
  const saved = value as Partial<ScoreState>;
  const scoreArray = (source: unknown, length: number, allowed: number[]) => {
    const values = Array.isArray(source) ? source : [];
    return Array.from({ length }, (_, index) => {
      const score = values[index];
      return typeof score === "number" && allowed.includes(score) ? score : 0;
    });
  };
  const artifactSource = Array.isArray(saved.artifacts) ? saved.artifacts : [];
  return {
    timeSeconds: typeof saved.timeSeconds === "number" && Number.isFinite(saved.timeSeconds) && saved.timeSeconds >= 0
      ? Math.round(saved.timeSeconds * 100) / 100
      : null,
    notes: typeof saved.notes === "string" ? saved.notes.slice(0, 500) : "",
    visitors: scoreArray(saved.visitors, 4, [0, 5, 10]),
    redTowers: scoreArray(saved.redTowers, 2, [0, 10, 15]),
    yellowTowers: scoreArray(saved.yellowTowers, 2, [0, 15, 25]),
    artifacts: Array.from({ length: 4 }, (_, index) => {
      const item = artifactSource[index];
      const color = item && typeof item === "object" && artifactColors.has((item as ArtifactState).color)
        ? (item as ArtifactState).color
        : "unused";
      const score = item && typeof item === "object" && [0, 5, 15].includes((item as ArtifactState).score)
        ? (item as ArtifactState).score
        : 0;
      return { color, score };
    }),
    dirt: scoreArray(saved.dirt, 10, [0, 2]),
    bonus: scoreArray(saved.bonus, 3, [0, 10]),
    updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : initial.updatedAt,
  };
};

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
  state.artifacts.every((item) => item.score === 0 || item.color !== "unused");

const sum = (values: Score[]) => values.reduce<number>((total, value) => total + value, 0);

