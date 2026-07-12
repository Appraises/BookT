"""
Curated glossary for closed-class (function) words.

Machine translation of an ISOLATED pronoun/article/preposition is unreliable —
especially through the English pivot, which drops gender and person entirely
("elle" -> "it" -> "ele"). Closed-class words are a small, finite set, so a
hand-checked dictionary answers those lookups before MT is even tried.

Only unambiguous, high-confidence mappings belong here; genuinely ambiguous
words (fr "en"/"y" as clitics, etc.) show both options or are omitted so the
contextual MT path handles them.
"""

GLOSSARIES = {
    ("fr", "pt"): {
        # personal pronouns
        "je": "eu", "tu": "tu", "il": "ele", "elle": "ela", "on": "a gente",
        "nous": "nós", "vous": "vocês", "ils": "eles", "elles": "elas",
        "moi": "mim", "toi": "ti", "lui": "ele, lhe", "eux": "eles",
        "me": "me", "te": "te", "se": "se",
        # articles & determiners
        "le": "o", "la": "a", "les": "os, as", "un": "um", "une": "uma",
        "des": "uns, umas", "du": "do", "au": "ao", "aux": "aos",
        "ce": "este, isso", "cet": "este", "cette": "esta", "ces": "estes, estas",
        "mon": "meu", "ma": "minha", "mes": "meus", "ton": "teu", "ta": "tua",
        "tes": "teus", "son": "seu", "sa": "sua", "ses": "seus",
        "notre": "nosso", "nos": "nossos", "votre": "seu (de vocês)",
        "vos": "seus (de vocês)", "leur": "deles, lhes", "leurs": "deles",
        # conjunctions, adverbs, question words
        "et": "e", "ou": "ou", "où": "onde", "mais": "mas", "donc": "então",
        "car": "pois", "si": "se", "que": "que", "qui": "que, quem",
        "quoi": "o quê", "quand": "quando", "comment": "como",
        "pourquoi": "por quê", "oui": "sim", "non": "não",
        "ne": "não (negação)", "pas": "não (negação)",
        "plus": "mais", "moins": "menos", "très": "muito", "trop": "demais",
        "aussi": "também", "déjà": "já", "encore": "ainda",
        "toujours": "sempre", "jamais": "nunca", "ici": "aqui", "là": "lá",
        "rien": "nada", "tout": "tudo", "tous": "todos", "toute": "toda",
        "toutes": "todas", "chaque": "cada",
        # prepositions
        "avec": "com", "sans": "sem", "pour": "para", "par": "por",
        "dans": "em", "en": "em", "sur": "sobre", "sous": "sob",
        "chez": "na casa de", "entre": "entre", "vers": "em direção a",
        "depuis": "desde", "avant": "antes", "après": "depois",
        "pendant": "durante", "contre": "contra",
        # core verbs (infinitive)
        "être": "ser, estar", "avoir": "ter",
        # common contractions (tokenized as single words by the reader)
        "c'est": "é, isso é", "c'était": "era, foi",
        "n'est": "não é", "n'était": "não era, não estava",
        "n'a": "não tem", "n'ai": "não tenho", "n'y": "não … aí",
        "s'est": "se (+ passado)", "s'était": "tinha se",
        "j'ai": "eu tenho", "j'étais": "eu era, eu estava", "j'avais": "eu tinha",
        "d'un": "de um", "d'une": "de uma",
        "l'on": "a gente", "qu'il": "que ele", "qu'elle": "que ela",
        "qu'ils": "que eles", "qu'elles": "que elas", "qu'on": "que a gente",
        "qu'un": "que um", "qu'une": "que uma",
        "s'il": "se ele", "s'ils": "se eles", "jusqu'à": "até",
        "aujourd'hui": "hoje", "quelqu'un": "alguém",
    },
    ("pl", "pt"): {
        # personal pronouns
        "ja": "eu", "ty": "tu", "on": "ele", "ona": "ela", "ono": "ele (neutro)",
        "my": "nós", "wy": "vocês", "oni": "eles", "one": "elas",
        "mnie": "mim", "ciebie": "ti", "jego": "dele", "jej": "dela",
        "ich": "deles", "nas": "nós", "was": "vocês",
        "mój": "meu", "moja": "minha", "twój": "teu", "twoja": "tua",
        "nasz": "nosso", "wasz": "de vocês",
        # conjunctions, adverbs, question words
        "i": "e", "ale": "mas", "lub": "ou", "albo": "ou", "że": "que",
        "kto": "quem", "co": "o quê", "gdzie": "onde", "kiedy": "quando",
        "jak": "como", "dlaczego": "por quê", "tak": "sim", "nie": "não",
        "tu": "aqui", "tam": "lá", "teraz": "agora", "zawsze": "sempre",
        "nigdy": "nunca", "bardzo": "muito", "też": "também", "już": "já",
        "jeszcze": "ainda", "wszystko": "tudo", "nic": "nada",
        # prepositions
        "z": "com, de", "w": "em", "na": "em, sobre", "do": "para, até",
        "od": "de, desde", "dla": "para", "o": "sobre", "po": "depois de, por",
        "przez": "através de, por", "przy": "junto a", "bez": "sem",
        "pod": "sob", "nad": "sobre", "przed": "antes de, diante de",
        "za": "atrás de, por",
    },
}


def glossary_lookup(word, source, target):
    """Return the curated translation for a function word, or None."""
    if not word:
        return None
    table = GLOSSARIES.get((source, target))
    if not table:
        return None
    return table.get(word.strip().casefold())
