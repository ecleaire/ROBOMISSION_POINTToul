export interface AnalyticsRecord {
  recordedAt: string;
  total: number;
  visitors: number;
  redTowers: number;
  yellowTowers: number;
  artifacts: number;
  dirt: number;
  bonus: number;
}

export const MISSION_LABELS = {
  visitors: "訪問者",
  redTowers: "赤い塔",
  yellowTowers: "黄色い塔",
  artifacts: "遺物",
  dirt: "汚れ",
  bonus: "ボーナス",
} as const;

export type MissionKey = keyof typeof MISSION_LABELS;

export const MISSION_MAX_SCORES: Record<MissionKey, number> = {
  visitors: 40,
  redTowers: 30,
  yellowTowers: 50,
  artifacts: 60,
  dirt: 20,
  bonus: 30,
};

export interface AnalyticsSelectionOptions {
  limit?: number | null;
  dateFrom?: string;
  dateTo?: string;
}

function dateBoundary(value: string | undefined, endOfDay = false) {
  if (!value) return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const time = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();
  if (Number.isNaN(time)) return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return time;
}

export function selectAnalyticsRecords(records: AnalyticsRecord[], options: AnalyticsSelectionOptions = {}) {
  const from = dateBoundary(options.dateFrom);
  const to = dateBoundary(options.dateTo, true);
  const ordered = records
    .filter((record) => {
      const recordedAt = new Date(record.recordedAt).getTime();
      return !Number.isNaN(recordedAt) && recordedAt >= from && recordedAt <= to;
    })
    .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime());
  return options.limit ? ordered.slice(0, options.limit) : ordered;
}

export function analyzeRecords(records: AnalyticsRecord[]) {
  const ordered = [...records].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const latest = ordered.at(-1);
  const previous = ordered.at(-2);
  const average = ordered.length ? ordered.reduce((sum, record) => sum + record.total, 0) / ordered.length : 0;
  const best = ordered.length ? Math.max(...ordered.map((record) => record.total)) : 0;
  const missions = (Object.keys(MISSION_LABELS) as MissionKey[]).map((key) => {
    const average = ordered.length ? ordered.reduce((sum, record) => sum + Number(record[key] || 0), 0) / ordered.length : 0;
    const max = MISSION_MAX_SCORES[key];
    return {
      key,
      label: MISSION_LABELS[key],
      max,
      average,
      successRate: Math.max(0, Math.min(100, average / max * 100)),
      latest: Number(latest?.[key] || 0),
      previous: Number(previous?.[key] || 0),
    };
  });
  return {
    count: ordered.length,
    average,
    best,
    latest: latest?.total ?? 0,
    previous: previous?.total ?? null,
    change: previous && latest ? latest.total - previous.total : null,
    missions,
    trend: ordered.slice(-12).map((record) => ({ recordedAt: record.recordedAt, total: record.total })),
  };
}

export function trendPolyline(values: number[], width = 600, height = 160) {
  if (!values.length) return "";
  const max = 230;
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index * width / (values.length - 1);
    const y = height - Math.max(0, Math.min(max, value)) / max * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}
