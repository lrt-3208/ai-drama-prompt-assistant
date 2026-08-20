-- v30: visual_styles 增加 negative_prompt（对照原型 03-assets 风格配置卡）
ALTER TABLE visual_styles
  ADD COLUMN IF NOT EXISTS negative_prompt TEXT;
