interface Article {
  title: string;
  description: string;
  tags: string[];
  href: string;
  passages: {heading: string; text: string}[];
}

const stop = new Set('请问 如何 怎么 怎样 为什么 什么 哪些 哪个 是什么 介绍 一下 一个 可以 文章 博客 关于 我想 知道 有没有 以及 这个 的 了 吗 呢 和 是 在 有 与 我 里 中 做 用 a the what is how to'.split(' '));
const segmenter = new Intl.Segmenter('zh', {granularity: 'word'});

export function search(articles: Article[], question: string) {
  const words = [...new Set(Array.from(segmenter.segment(question.toLowerCase()))
    .filter(item => item.isWordLike && !stop.has(item.segment)).map(item => item.segment))];
  const fields = articles.map(article =>
    [article.title, ...article.tags, ...article.passages.map(p => p.heading + p.text)].join(' ').toLowerCase());
  const weights = words.map(word => Math.log(1 + articles.length / (1 + fields.filter(f => f.includes(word)).length)));
  const score = (value: string) => {
    const normalized = value.toLowerCase();
    return words.reduce((sum, word, i) => sum + (normalized.includes(word) ? weights[i] : 0), 0);
  };
  return articles.flatMap(article => {
    const ranked = article.passages.map(p => {
      const sentences = p.text.split(/(?<=[。！？])|\n+/).map(s => s.trim()).filter(Boolean);
      const best = sentences.map((s, i) => ({i, points: score(s)})).sort((a,b) => b.points-a.points)[0];
      const excerpt = sentences.slice(best.i, best.i + 2).join(' ');
      return {excerpt, heading: p.heading, points: best.points + score(p.heading) * 0.35};
    }).sort((a,b) => b.points-a.points);
    if (!ranked.length) return [];
    const points = ranked[0].points + score(article.title) * 0.5
      + score(article.description) * 0.7 + score(article.tags.join(' ')) * 0.25;
    return points ? [{...ranked[0], title: article.title, href: article.href, points}] : [];
  }).sort((a,b) => b.points-a.points).slice(0, 3);
}
