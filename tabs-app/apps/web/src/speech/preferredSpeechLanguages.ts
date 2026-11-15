/** Language tags the user prefers, most preferred first, reduced to their base language. */
export function preferredSpeechLanguages() {
  return navigator.languages.map((tag) => tag.toLowerCase().split(/[-_]/)[0]!);
}
