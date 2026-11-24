import { MarkdownNodeParser } from '@llamaindex/core/node-parser';
import { Document } from '@llamaindex/core/schema';
import { getPublishedPosts, url } from '../utils';

export async function GET() {
  const parser = new MarkdownNodeParser();
  const posts = await getPublishedPosts();
  const articles = posts.filter(post => !post.data.draft).map(post => {
    const markdown = (post.body ?? '')
      .replace(/<(figure|svg|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>\n]+>/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1');
    const sections = parser.getNodesFromNode(new Document({text: markdown}));
    const passages = sections.flatMap(section => {
      const heading = String(Object.values(section.metadata).at(-1) ?? '');
      const body = heading ? section.text.slice(heading.length) : section.text;
      return body.replace(/^`{3}[^\n]*\n[\s\S]*?^`{3}[^\n]*$/gm, '')
        .split(/\n\s*\n/).map(p => p.replace(/[*`]/g, '').trim())
        .filter(p => p.length > 5).map(text => ({heading, text}));
    });
    return {title: post.data.title, description: post.data.description, tags: post.data.tags, href: url(`/posts/${post.id}/`), passages};
  });
  return Response.json(articles);
}
