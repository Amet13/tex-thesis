import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Guide pages live outside the site so they read well on GitHub too. */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../docs/guide' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(100),
    section: z.string().default('Reference'),
  }),
});

export const collections = { docs };
