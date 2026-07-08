// Function words and ultra-common fillers that carry little learning value.
// Used to drop trivial tokens before building cards.
export const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'so', 'as', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'here', 'there',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'is', 'am', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'would', 'could', 'shall', 'may', 'might', 'must', 'i', 'me', 'my', 'myself',
  'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself',
  'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'whose',
  'when', 'where', 'why', 'how', 'because', 'until', 'while', 'of', 'this',
  'im', 'ive', 'id', 'ill', 'youre', 'youve', 'youll', 'hes', 'shes', 'theyre',
  'weve', 'were', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent',
  'cant', 'couldnt', 'wouldnt', 'shouldnt', 'wont', 'thats', 'theres', 'its',
  'gonna', 'wanna', 'gotta', 'yeah', 'yep', 'nope', 'okay', 'ok', 'oh', 'uh',
  'um', 'hmm', 'huh', 'hey', 'ah', 'eh', 'mm', 'mhm', 'ya', 'na',
]);
