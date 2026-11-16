// dsh-music mood question: the one thing a model is asked in Music Coding mode. Built to be answerable by small
// models: the plugin gathers the facts (lyrics excerpt, later measured tempo) and the model only picks a letter.
// Each song is asked once; the answer is cached by the host.

export const MOOD_SYSTEM = [
  '你是音乐分类器。判断一首歌听起来整体是安静、中等还是带劲。',
  '规则：',
  '1. 你确实熟悉这首歌（知道它的曲风和节奏），就按你的了解回答。',
  '2. 不熟悉这首歌，就只看给出的资料推断；歌词只能说明情绪，不能单靠歌词断定节奏，没有把握就选 D。',
  '3. 不认识、资料也不够，选 D。不要猜，不要编。',
  '只输出一个大写字母，不要输出任何别的内容。',
].join('\n');

/** @param song {title, artist, album, bpm?, energy?, excerpt?: string[]} */
export function moodPrompt(song) {
  const facts = [];
  if (song.bpm) facts.push(`实测速度：约 ${Math.round(song.bpm)} BPM`);
  if (song.energy != null) facts.push(`实测激烈程度：${Math.round(song.energy * 100)}/100`);
  if (song.instrumental) facts.push('这是纯音乐，没有歌词');
  if (song.excerpt?.length) facts.push(`歌词片段：\n${song.excerpt.join('\n')}`);
  return [
    `歌名：${song.title}`,
    `歌手：${song.artist || '未知'}`,
    song.album ? `专辑：${song.album}` : null,
    facts.length ? `资料：\n${facts.join('\n')}` : '资料：无',
    '',
    '这首歌听起来整体是？',
    'A 安静（慢、柔和，适合专注）',
    'B 中等',
    'C 带劲（快、强烈，能提神）',
    'D 不知道',
  ].filter((l) => l !== null).join('\n');
}

/** First letter A-D in the reply, else D. */
export const parseMood = (reply) => (/[ABCD]/.exec(String(reply ?? '').toUpperCase())?.[0] ?? 'D');

/** A short excerpt for the prompt: a few lines from the first chorus-ish part, with translations. */
export function excerptOf(lyrics, max = 6) {
  if (!lyrics?.lines?.length) return [];
  const lines = lyrics.lines;
  const start = Math.min(Math.floor(lines.length / 4), Math.max(0, lines.length - max));
  return lines.slice(start, start + max).map((l) => (l.tr ? `${l.text}（${l.tr}）` : l.text));
}
