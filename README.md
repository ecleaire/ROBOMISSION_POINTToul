# RoboMission Junior 得点計算

WRO 2026 RoboMission Juniorを練習する選手向けの、判定写真付き得点計算Webアプリです。スマートフォン、タブレット、PCで利用でき、PWAとしてインストールすると採点と判定写真をオフラインでも利用できます。

> このアプリは非公式の練習補助ツールです。正式な判定には各大会の公式ルールと審判の判断を使用してください。

## 主な機能

- 6ミッション、最大230点の得点計算
- 0点と未判定を区別した入力
- 公式ルール掲載例を整理した判定写真モーダル
- 途中状態の端末内保存（`localStorage`）
- 結果画像の保存と印刷
- Google Apps Script経由で指定スプレッドシートへ練習結果を追記
- PWA・オフライン対応

## 使い方

1. 「採点を始める」を押します。
2. チーム名、ラウンド、競技時間を入力します。
3. 各対象について得点を1つ選びます。迷った場合は「判定写真を見る」で確認します。
4. 「結果を見る」を押し、未判定の有無と合計を確認します。
5. 必要に応じて結果画像を保存、印刷、またはGoogleスプレッドシートへ記録します。

## 開発

Node.js 20以上を使用します。

```bash
npm install
npm run dev
```

テストと本番ビルド：

```bash
npm test
npm run build
```

ビルド結果は`dist/`に生成されます。GitHub Pagesのリポジトリ名が変わる場合は、`vite.config.ts`の`base`も変更してください。

## Googleスプレッドシート連携

送信先スプレッドシートIDは`gas/Code.gs`に設定済みです。Apps Scriptプロジェクト（スクリプトID `1dZLK_-vhhS-uTBt8huiPr34bBiMobmk723eGAYUALNFtPOu5vIRVeLWo`）で次を行います。

1. `gas/Code.gs`の内容をApps Scriptエディタへ貼り付けて保存します。
2. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選びます。
3. 実行ユーザーを自分、アクセスできるユーザーを利用環境に合う公開範囲にします。選手がログインせず使う場合は「全員」を選びます。
4. 初回承認後、発行された`https://script.google.com/macros/s/.../exec` URLをコピーします。
5. アプリの結果画面にURLを入力し、「この結果を記録する」を押します。URLは端末内に保存されます。

結果はスプレッドシート内の「練習記録」タブへ1採点1行で追加されます。Apps Scriptの設定画面URLやスクリプトIDそのものは送信先URLとしては使えません。

## GitHub Pages公開

`.github/workflows/deploy.yml`を同梱しています。GitHubのリポジトリ設定で Pages のSourceを「GitHub Actions」に変更し、`main`へpushすると、テストとビルド後に自動公開されます。

## ルール・画像の出典と権利

採点条件と判定写真は、World Robot Olympiad Association Ltd.発行の「WRO 2026 RoboMission Junior Game Rules」（主に8〜15ページ）を参照しています。判定画像は提供されたPDF由来画像をWeb表示用にWebP変換し、`public/assets/judging/`にミッション別で整理しています。

ルール本文・判定画像の権利は各権利者に帰属します。本リポジトリで再配布・公開する前に、公式規約と画像利用条件を確認してください。

WROおよびWROロゴはWorld Robot Olympiad Association Ltd.の商標です。本アプリはWRO公式アプリではなく、WROロゴも使用していません。
