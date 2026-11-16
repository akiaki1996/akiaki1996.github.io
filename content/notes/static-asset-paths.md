---
id: static-asset-paths
index: N-02
title: 静态资源与图片相对路径排查记录
date: 2023-05-12
category: 工程排坑
tags: Static Site, Markdown, Assets
summary: 迁移自原站点备忘：确保文章与配图资源路径在静态站点重构与部署后长期稳定可访问。
---

## 问题背景

此前使用旧静态博客框架（Hexo + `hexo-asset-image`）时，Markdown 文章内的相对图片路径在编译生成 HTML 后经常出现路径解析偏差，导致本地可见而线上图片裂开。

## 排查与规范做法

1. **资源路径统一**：将需要长期保留的图片资产（如 `2023glasses.jpg`）集中存放在静态资源目录 `src/assets/`，构建时统一拷贝至输出目录 `/assets/`。
2. **相对与绝对引用一致**：站点页面统一基于规范化路径引用资源，避免依赖第三方插件的脆弱正则替换。
3. **构建即校验**：在静态构建脚本中确保资源复制与目录结构与 HTML 引用完全匹配。

```text
src/assets/2023glasses.jpg  ──(build)──▶  public/assets/2023glasses.jpg
```
