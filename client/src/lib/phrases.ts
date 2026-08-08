// Multi-word units that must stay together: splitting them destroys the
// meaning ("kind of" is not "kind", "figure out" is not "figure" + "out").
// Listed in base form — the matcher lemmatizes the verb, so "figured out"
// and "figures out" both match "figure out".

export const PHRASES: string[] = [
  // --- discourse / hedging (very common in speech) ---
  'kind of', 'sort of', 'a lot of', 'a bit', 'a little bit', 'of course',
  'at all', 'at least', 'at last', 'after all', 'as well', 'as usual',
  'by the way', 'in fact', 'in general', 'in particular', 'in other words',
  'for example', 'for instance', 'such as', 'so that', 'even though',
  'as long as', 'as soon as', 'no matter', 'in order to', 'instead of',
  'rather than', 'according to', 'because of', 'due to', 'thanks to',
  'up to', 'out of', 'apart from', 'along with', 'as far as', 'in terms of',
  'on purpose', 'by accident', 'at once', 'right away', 'right now',
  'these days', 'the other day', 'once again', 'over and over', 'more or less',
  'at the same time', 'in the end', 'at the end of the day', 'for good',
  'no longer', 'as if', 'what if', 'you know', 'i mean', 'let alone',

  // --- phrasal verbs: core ---
  'figure out', 'find out', 'turn out', 'come out', 'come up', 'come up with',
  'come back', 'come across', 'come along', 'come down', 'come in', 'come on',
  'go on', 'go out', 'go back', 'go through', 'go over', 'go down', 'go up',
  'go ahead', 'get up', 'get out', 'get in', 'get back', 'get through',
  'get along', 'get over', 'get rid of', 'get away', 'get into', 'get off',
  'give up', 'give in', 'give away', 'give back', 'give out',
  'take off', 'take on', 'take out', 'take over', 'take up', 'take care of',
  'take place', 'take advantage of', 'take a look',
  'put on', 'put off', 'put up with', 'put down', 'put together', 'put back',
  'look for', 'look at', 'look up', 'look after', 'look forward to',
  'look into', 'look out', 'look like', 'look back',
  'make up', 'make out', 'make sure', 'make sense', 'make a difference',
  'set up', 'set out', 'set off', 'set aside',
  'break down', 'break up', 'break out', 'break through',
  'bring up', 'bring back', 'bring about', 'bring in', 'bring together',
  'call off', 'call back', 'call for', 'call out',
  'carry out', 'carry on',
  'check out', 'check in', 'check on',
  'clean up', 'close down',
  'cut off', 'cut down', 'cut out',
  'deal with', 'depend on', 'end up', 'fall apart', 'fall behind',
  'fill in', 'fill out', 'fill up',
  'focus on', 'grow up', 'hand in', 'hand out', 'hang out', 'hang up',
  'hold on', 'hold back', 'keep on', 'keep up', 'keep track of',
  'knock down', 'lay out', 'let down', 'let go', 'line up', 'live up to',
  'log in', 'log out', 'move on', 'move in', 'move out',
  'pass away', 'pass out', 'pay attention', 'pay off', 'pick up', 'pick out',
  'point out', 'pull out', 'pull off', 'push back',
  'reach out', 'rely on', 'result in', 'roll out', 'run into', 'run out of',
  'run away', 'save up', 'scale up', 'sell out', 'send out',
  'settle down', 'show up', 'shut down', 'shut up',
  'sign up', 'sign in', 'sit down', 'slow down', 'speed up',
  'stand out', 'stand up', 'stand for', 'start over', 'stay up',
  'stick to', 'stick with', 'sum up', 'switch off', 'switch on',
  'tear down', 'think about', 'think of', 'think through', 'throw away',
  'try out', 'turn on', 'turn off', 'turn into', 'turn down', 'turn around',
  'wake up', 'walk away', 'warm up', 'watch out', 'wear out',
  'work out', 'work on', 'wrap up', 'write down',

  // --- common idioms / collocations ---
  'as a result', 'at the moment', 'in the meantime', 'on the other hand',
  'on the one hand', 'in addition', 'on average', 'in advance',
  'by far', 'so far', 'for now', 'for a while', 'in a row', 'in a way',
  'all of a sudden', 'to be honest', 'to be fair', 'as a matter of fact',
  'keep in mind', 'make a point', 'change your mind', 'have a point',
  'a couple of', 'plenty of', 'the rest of', 'most of', 'part of',
  'in charge of', 'capable of', 'aware of', 'instead',
  'on top of', 'in front of', 'next to', 'as opposed to',
  'turn the corner', 'the bottom line', 'big deal', 'no wonder',
  'pre mortem', 'post mortem',
];

/** Phrases indexed by first word, longest first — for greedy matching. */
export const PHRASE_INDEX: Map<string, string[][]> = (() => {
  const index = new Map<string, string[][]>();
  for (const phrase of PHRASES) {
    const parts = phrase.split(' ');
    const list = index.get(parts[0]) || [];
    list.push(parts);
    index.set(parts[0], list);
  }
  // longest phrases first so "come up with" wins over "come up"
  for (const list of index.values()) list.sort((a, b) => b.length - a.length);
  return index;
})();

export const MAX_PHRASE_WORDS = PHRASES.reduce(
  (m, p) => Math.max(m, p.split(' ').length),
  1,
);
