// Разговорные написания: то, что реально звучит в речи.
//
// Учебники дают «правильные» формы, а на YouTube говорят «cuz», «gonna»,
// «kinda». Человек, знающий «because», в потоке речи «cuz» не узнаёт — значит
// это ровно та лексика, которую стоит показать, а не отфильтровать.
//
// Ключ — как слышится, значение — что это на самом деле. Перевод берётся у
// канонической формы: сами разговорные написания переводчик знает через раз
// («outta» он отдаёт как «сбился», «ya» как «да», «hafta» просто
// транслитерирует).

const MAP: Record<string, string> = {
  aint: 'is not',
  betcha: 'bet you',
  coulda: 'could have',
  cuz: 'because',
  coz: 'because',
  dunno: 'do not know',
  gimme: 'give me',
  gonna: 'going to',
  gotcha: 'got you',
  gotta: 'have to',
  hafta: 'have to',
  innit: 'is not it',
  kinda: 'kind of',
  lemme: 'let me',
  lotta: 'lot of',
  musta: 'must have',
  outta: 'out of',
  shoulda: 'should have',
  sorta: 'sort of',
  tryna: 'trying to',
  wanna: 'want to',
  whatcha: 'what are you',
  woulda: 'would have',
  ya: 'you',
  yall: 'you all',
};

/**
 * Каноническая форма разговорного написания, либо undefined.
 *
 * Апострофы игнорируются: «ain't» и «aint», «y'all» и «yall» — одно и то же.
 */
export function canonicalOf(token: string): string | undefined {
  return MAP[token.replace(/'/g, '')];
}
