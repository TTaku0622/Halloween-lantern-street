-- 灯りの色を選べるようにする（既存のデータベース向け）
ALTER TABLE lanterns ADD COLUMN color TEXT;
