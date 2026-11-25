import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // 可选封面图（相对站点根目录的路径，如 /covers/xxx.png）；不填则自动生成渐变封面
    cover: z.string().optional(),
    // 用正文里的第几幅示意图（从 1 开始）当封面；不填则自动挑信息量最大的一幅
    coverFigure: z.number().int().positive().optional(),
  }),
});

export const collections = { posts };
