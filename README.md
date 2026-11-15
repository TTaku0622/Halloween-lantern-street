# ランタン通り

みんなが彫ったカボチャのランタンが並ぶ夜の通り。周りの音に合わせて灯りが揺れます。

**▶ https://lantern-street.lolipop-now.app**

## 使い方

- 「ランタンを彫る」でカボチャを彫り、灯りの色とニックネームを決めて灯す（匿名でも OK）
- 灯したランタンは通りに並ぶ。スクロール・ドラッグ・上下キーで歩き、ランタンを押すと大きく見られる
- 「周りの音で灯す」をオンにすると、マイクで拾った音の大きさで灯りが揺れる（録音・送信はしない）

## 構成

- 画面：Astro（静的書き出し。ページは `site/pages/`、JS・CSS は `public/`）
- API・保存：Cloudflare Workers（`src/worker.js`）、D1
- Canvas 2D で通りとランタンを描画、Web Audio で音量を測定
- `wrangler dev` / `wrangler deploy` の前に `astro build` が自動で走り、`dist/` を配信する
- ほかのドメイン（デプロイナウなど）に置いた画面からは、Cloudflare の API を呼ぶ（`public/js/api.js`）

## 開発

```sh
npm install
npx wrangler d1 execute lantern-street --local --file schema.sql
npm run dev
```
