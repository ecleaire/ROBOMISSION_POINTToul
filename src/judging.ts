export interface JudgingPhoto {
  src: string;
  score: string;
  label: string;
  description: string;
}

export interface JudgingGroup {
  title: string;
  photos: JudgingPhoto[];
}

const image = (folder: string, name: string) =>
  `${import.meta.env.BASE_URL}assets/judging/${folder}/${name}.webp`;

export const judgingGroups: Record<string, JudgingGroup> = {
  visitors: {
    title: "訪問者の判定写真",
    photos: [
      { src: image("visitors", "full-upright"), score: "10点", label: "満点", description: "対応色のエリアに完全に入り、直立しています。" },
      { src: image("visitors", "partial"), score: "5点", label: "部分点", description: "対応色のエリアに一部だけ入っています。" },
      { src: image("visitors", "fallen"), score: "5点", label: "部分点", description: "対応色のエリア内ですが、倒れています。" },
      { src: image("visitors", "outside"), score: "0点", label: "0点", description: "対応色のエリアに入っていません。" },
      { src: image("visitors", "wrong-color"), score: "0点", label: "0点", description: "違う色のエリアに置かれています。" },
    ],
  },
  redTowers: {
    title: "赤い塔の判定写真",
    photos: [
      { src: image("red-towers", "full"), score: "15点", label: "満点", description: "赤い対象エリア（オレンジの境界を含む）に完全に入り、直立しています。" },
      { src: image("red-towers", "partial"), score: "10点", label: "部分点", description: "直立していますが、対象エリアには一部だけ入っています。" },
      { src: image("red-towers", "outside"), score: "0点", label: "0点", description: "対象エリアの外にあります。" },
      { src: image("red-towers", "fallen"), score: "0点", label: "0点", description: "直立していません。" },
    ],
  },
  yellowTowers: {
    title: "黄色い塔の判定写真",
    photos: [
      { src: image("yellow-towers", "full"), score: "25点", label: "満点", description: "上部が正しく置かれ、土台が対象エリアに完全に入っています。" },
      { src: image("yellow-towers", "partial"), score: "15点", label: "部分点", description: "上部は正しく置かれていますが、土台は対象エリアに一部だけ入っています。" },
      { src: image("yellow-towers", "outside"), score: "0点", label: "0点", description: "塔が対象エリアの外にあります。" },
      { src: image("yellow-towers", "incorrect"), score: "0点", label: "0点", description: "上部が正しく置かれていない、または直立していません。" },
    ],
  },
  artifacts: {
    title: "遺物の判定写真",
    photos: [
      { src: image("artifacts", "full"), score: "15点", label: "満点", description: "対応色の展示場所に完全に入り、直立しています。" },
      { src: image("artifacts", "partial"), score: "5点", label: "部分点", description: "対応色の展示場所に一部だけ入っています。" },
      { src: image("artifacts", "fallen"), score: "5点", label: "部分点", description: "対応色の展示場所に入っていますが、倒れています。" },
      { src: image("artifacts", "outside"), score: "0点", label: "0点", description: "展示場所の外にあります。" },
      { src: image("artifacts", "wrong-color"), score: "0点", label: "0点", description: "違う色の展示場所に置かれています。" },
    ],
  },
  dirt: {
    title: "石畳の汚れの判定写真",
    photos: [
      { src: image("dirt", "area"), score: "範囲", label: "石畳エリア", description: "茶色の範囲と赤いバリアの灰色エリアが石畳です。線と訪問者エリアは含みません。" },
      { src: image("dirt", "clear"), score: "2点/個", label: "満点", description: "汚れが石畳エリアに触れていません。" },
      { src: image("dirt", "touching"), score: "0点", label: "0点", description: "汚れが石畳エリアに触れています。" },
      { src: image("dirt", "visitor-area"), score: "2点", label: "満点", description: "訪問者エリアは石畳に含まれません。" },
      { src: image("dirt", "line"), score: "2点", label: "満点", description: "フィールド上の線は石畳に含まれません。" },
    ],
  },
  bonus: {
    title: "バリア・オウムの判定写真",
    photos: [
      { src: image("bonus", "red-ok"), score: "10点", label: "満点", description: "赤いバリアが移動も損傷もしていません。" },
      { src: image("bonus", "red-moved"), score: "0点", label: "0点", description: "赤いバリアが灰色エリアの外へ移動しています。" },
      { src: image("bonus", "red-damaged"), score: "0点", label: "0点", description: "赤いバリアが損傷しています。" },
      { src: image("bonus", "white-ok"), score: "10点", label: "満点", description: "白いバリアが移動も損傷もしていません。" },
      { src: image("bonus", "white-moved"), score: "0点", label: "0点", description: "白いバリアが灰色エリアの外へ移動しています。" },
      { src: image("bonus", "parrot-ok"), score: "10点", label: "満点", description: "オウムが移動も損傷もしていません。" },
      { src: image("bonus", "parrot-moved"), score: "0点", label: "0点", description: "オウムが灰色エリアの外へ移動しています。" },
    ],
  },
};
