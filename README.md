# ランタン通り

みんなが彫ったカボチャのランタンが並ぶ夜の通り。周りの音に合わせて灯りが揺れます。

**▶ https://lantern-street.lantern-street.workers.dev**

## 使い方

- 「ランタンを彫る」でカボチャを彫り、灯りの色とニックネームを決めて灯す（匿名でも OK）
- 灯したランタンは通りに並ぶ。スクロール・ドラッグ・上下キーで歩き、ランタンを押すと大きく見られる
- 「周りの音で灯す」をオンにすると、マイクで拾った音の大きさで灯りが揺れる（録音・送信はしない）

## 構成

- Cloudflare Workers（静的アセット ＋ API）、D1
- Canvas 2D で通りとランタンを描画、Web Audio で音量を測定

## 開発

```sh
npm install
npx wrangler d1 execute lantern-street --local --file schema.sql
npm run dev
```
