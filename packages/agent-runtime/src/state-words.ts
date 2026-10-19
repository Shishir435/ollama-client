/**
 * Control-state words in the seven spaced locales besides English (de, es,
 * fr, it, ru, hi): what a requirement says when a box is ticked, a switch
 * turned off or terms accepted. English keeps its own patterns in
 * `completion.ts`; these are read beside them.
 *
 * Every list is a closed set of whole words, inflections written out, so a
 * word that merely begins like a state ("marca", a brand) is not one. The
 * reading is deliberately fail-safe: a negation anywhere in the text flips a
 * state word to its opposite and makes an off word ambiguous, because word
 * order differs too much across these languages ("चुना नहीं गया") to scope a
 * negation to the word it governs. A requirement read wrongly here pauses for
 * review; it never completes.
 *
 * Japanese and Chinese write no spaces, so their requirements cannot be split
 * into the words the typed checks count, and they stay with review.
 */

const wholeWords = (words: readonly string[]): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{M}\\p{N}])`,
    "iu"
  )

const ON_WORDS = [
  "angehakt",
  "angekreuzt",
  "aktiviert",
  "ausgewählt",
  "eingeschaltet",
  "markiert",
  "anhaken",
  "ankreuzen",
  "aktivieren",
  "auswählen",
  "einschalten",
  "markieren",
  "marcad[oa]s?",
  "activad[oa]s?",
  "seleccionad[oa]s?",
  "encendid[oa]s?",
  "marcar",
  "activar",
  "seleccionar",
  "encender",
  "coch[ée]e?s?",
  "activ[ée]e?s?",
  "sélectionn[ée]e?s?",
  "cocher",
  "activer",
  "sélectionner",
  "cochez",
  "activez",
  "sélectionnez",
  "spuntat[oaie]",
  "attivat[oaie]",
  "selezionat[oaie]",
  "abilitat[oaie]",
  "spuntare",
  "attivare",
  "selezionare",
  "abilitare",
  "отмечен[аоы]?",
  "включен[аоы]?",
  "выбран[аоы]?",
  "активирован[аоы]?",
  "отметить",
  "отметьте",
  "включить",
  "включите",
  "выбрать",
  "выберите",
  "चुना",
  "चुनी",
  "चुने",
  "चयनित",
  "सक्षम",
  "चालू",
  "टिक"
]

const OFF_WORDS = [
  "deaktiviert",
  "abgewählt",
  "ausgeschaltet",
  "deaktivieren",
  "abwählen",
  "ausschalten",
  "desmarcad[oa]s?",
  "desactivad[oa]s?",
  "deseleccionad[oa]s?",
  "apagad[oa]s?",
  "desmarcar",
  "desactivar",
  "deseleccionar",
  "apagar",
  "décoch[ée]e?s?",
  "désactiv[ée]e?s?",
  "désélectionn[ée]e?s?",
  "décocher",
  "désactiver",
  "désélectionner",
  "décochez",
  "désactivez",
  "deselezionat[oaie]",
  "disattivat[oaie]",
  "disabilitat[oaie]",
  "deselezionare",
  "disattivare",
  "disabilitare",
  "выключен[аоы]?",
  "отключен[аоы]?",
  "деактивирован[аоы]?",
  "выключить",
  "выключите",
  "отключить",
  "отключите",
  "снят[аоы]?",
  "снять",
  "снимите",
  "अचयनित",
  "अक्षम",
  "बंद"
]

/** Terms are accepted, or agreed to, by ticking their box. */
const ACCEPT_WORDS = [
  "akzeptiert",
  "akzeptieren",
  "akzeptiere",
  "zugestimmt",
  "zustimmen",
  "einverstanden",
  "aceptad[oa]s?",
  "aceptar",
  "acepto",
  "acepta",
  "accept[ée]e?s?",
  "accepter",
  "acceptez",
  "accettat[oaie]",
  "accettare",
  "accetto",
  "accetta",
  "принят[аоы]?",
  "принять",
  "примите",
  "принимаю",
  "согласен",
  "согласна",
  "согласие",
  "соглашаюсь",
  "स्वीकार",
  "स्वीकृत",
  "सहमत"
]

/**
 * English "not" too: "active", "accepted" and "selected" are French and
 * English alike, so "the newsletter is not active" reaches these words.
 */
const NEGATION_WORDS = [
  "not",
  "nicht",
  "kein",
  "keine",
  "keinen",
  "nie",
  "niemals",
  "ohne",
  "no",
  "nunca",
  "sin",
  "ne",
  "n",
  "pas",
  "jamais",
  "sans",
  "non",
  "mai",
  "senza",
  "né",
  "не",
  "нет",
  "никогда",
  "без",
  "ни",
  "नहीं",
  "न",
  "मत",
  "बिना"
]

/**
 * Words that assert nothing by themselves in a state requirement: articles,
 * auxiliaries, prepositions and the names of controls. Like the English set,
 * it holds no negation, no conjunction and no verb but the state words.
 */
const FUNCTION_WORDS = new Set([
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "ist",
  "sind",
  "war",
  "wurde",
  "wurden",
  "wird",
  "werden",
  "jetzt",
  "hier",
  "bitte",
  "sie",
  "auf",
  "im",
  "am",
  "zu",
  "zum",
  "zur",
  "für",
  "von",
  "vom",
  "kästchen",
  "kontrollkästchen",
  "häkchen",
  "schalter",
  "feld",
  "schaltfläche",
  "el",
  "la",
  "los",
  "las",
  "lo",
  "un",
  "una",
  "es",
  "está",
  "están",
  "fue",
  "sido",
  "ha",
  "han",
  "ahora",
  "aquí",
  "por",
  "favor",
  "en",
  "al",
  "del",
  "de",
  "para",
  "casilla",
  "interruptor",
  "opción",
  "campo",
  "botón",
  "le",
  "les",
  "l",
  "une",
  "est",
  "sont",
  "été",
  "a",
  "ont",
  "maintenant",
  "ici",
  "sur",
  "dans",
  "à",
  "au",
  "aux",
  "du",
  "des",
  "d",
  "pour",
  "case",
  "champ",
  "bouton",
  "vous",
  "il",
  "gli",
  "è",
  "sono",
  "stato",
  "stata",
  "ora",
  "qui",
  "per",
  "su",
  "alla",
  "della",
  "di",
  "da",
  "casella",
  "opzione",
  "pulsante",
  "это",
  "сейчас",
  "здесь",
  "пожалуйста",
  "в",
  "на",
  "для",
  "должен",
  "должна",
  "должно",
  "флажок",
  "флажка",
  "переключатель",
  "опция",
  "опцию",
  "поле",
  "кнопка",
  "кнопку",
  "отметка",
  "отметку",
  "галочка",
  "галочку",
  "है",
  "हैं",
  "था",
  "थी",
  "थे",
  "गया",
  "गई",
  "गए",
  "को",
  "का",
  "की",
  "के",
  "में",
  "पर",
  "अब",
  "यहाँ",
  "कृपया",
  "बॉक्स",
  "चेकबॉक्स",
  "स्विच",
  "विकल्प",
  "बटन",
  "करें",
  "किया",
  "कर",
  "दिया"
])

const ON = wholeWords(ON_WORDS)
const OFF = wholeWords(OFF_WORDS)
const ACCEPT = wholeWords(ACCEPT_WORDS)
const NEGATION = wholeWords(NEGATION_WORDS)
const NEGATION_WORD = new RegExp(`^(?:${NEGATION_WORDS.join("|")})$`, "iu")
const STATE_WORD = new RegExp(
  `^(?:${[...ON_WORDS, ...OFF_WORDS, ...ACCEPT_WORDS].join("|")})$`,
  "iu"
)

/** Whether the text holds a negation in one of these locales. */
export const localeNegates = (text: string): boolean => NEGATION.test(text)

/**
 * The text asserts a control is on: an on word with no negation, or a
 * negated off word, which is ambiguous and so asserts both.
 */
export const localeAssertsOn = (text: string): boolean =>
  localeNegates(text) ? OFF.test(text) : ON.test(text)

/**
 * The text asserts a control is off: an off word, or an on word with a
 * negation anywhere beside it.
 */
export const localeAssertsOff = (text: string): boolean =>
  OFF.test(text) || (localeNegates(text) && ON.test(text))

/** The text speaks of accepting or agreeing, with no negation. */
export const localeAccepts = (text: string): boolean =>
  ACCEPT.test(text) && !localeNegates(text)

/** A word a state requirement may hold without claiming anything else. */
export const isLocaleStateClaimWord = (word: string): boolean =>
  FUNCTION_WORDS.has(word) || STATE_WORD.test(word)

/** A negation word, which a typed value or control name never counts as. */
export const isLocaleNegationWord = (word: string): boolean =>
  NEGATION_WORD.test(word)
