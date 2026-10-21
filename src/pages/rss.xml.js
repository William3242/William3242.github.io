import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getPublishedPosts } from '../utils';

export async function GET(context) {
  const posts = await getPublishedPosts();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `${base}/posts/${p.id}/`,
    })),
  });
}
