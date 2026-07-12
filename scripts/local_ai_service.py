import io
import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from faster_whisper import WhisperModel

from alignment import build_alignment
from function_words import glossary_lookup
from polish_grammar import WalentyDictionary, explain_case

ARGOS_ROOT = Path(
    os.environ.get(
        "BOOKT_ARGOS_HOME",
        Path(__file__).resolve().parents[1] / ".codex-run" / "argos",
    )
)
STANZA_ROOT = Path(
    os.environ.get(
        "BOOKT_STANZA_HOME",
        Path(__file__).resolve().parents[1] / ".codex-run" / "stanza",
    )
)
WALENTY_ROOT = Path(
    os.environ.get(
        "BOOKT_WALENTY_HOME",
        Path(__file__).resolve().parents[1] / ".codex-run" / "walenty",
    )
)
os.environ.setdefault("XDG_CONFIG_HOME", str(ARGOS_ROOT / "config"))
os.environ.setdefault("XDG_DATA_HOME", str(ARGOS_ROOT / "data"))
os.environ.setdefault("XDG_CACHE_HOME", str(ARGOS_ROOT / "cache"))
os.environ.setdefault("ARGOS_PACKAGES_DIR", str(ARGOS_ROOT / "packages"))

try:
    import argostranslate.translate
    import argostranslate.package
except ImportError:
    argostranslate = None

try:
    import morfeusz2
except ImportError:
    morfeusz2 = None

try:
    import stanza
except ImportError:
    stanza = None

# Languages the UI offers (kept in sync with the frontend language list).
SUPPORTED_LANGUAGES = ["fr", "en", "es", "de", "it", "pt", "pl", "ja", "zh", "ru", "ko", "nl"]


HOST = os.environ.get("BOOKT_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("BOOKT_AI_PORT", "8000"))
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
TRANSLATION_TARGET = os.environ.get("BOOKT_TRANSLATION_TARGET", "pt")
TRANSLATION_VARIANT = os.environ.get("BOOKT_TRANSLATION_VARIANT", "pt-BR")

LANGUAGE_ALIASES = {
    "polish": "pl",
    "polski": "pl",
    "pl": "pl",
    "english": "en",
    "en": "en",
    "portuguese": "pt",
    "portugues": "pt",
    "português": "pt",
    "pt": "pt",
    "pt-br": "pt",
    "pt_br": "pt",
    "br": "pt",
    "brazilian portuguese": "pt",
}

BRAZILIAN_PORTUGUESE_REPLACEMENTS = [
    (r"\bcomo est\u00e1s\b", "como voc\u00ea est\u00e1"),
    (r"\btu est\u00e1s\b", "voc\u00ea est\u00e1"),
    (r"\btu \u00e9s\b", "voc\u00ea \u00e9"),
    (r"\btu tens\b", "voc\u00ea tem"),
    (r"\best\u00e1s\b", "est\u00e1"),
    (r"\btens\b", "tem"),
    (r"\bpolaca\b", "polonesa"),
    (r"\bpolaco\b", "polon\u00eas"),
    (r"\bpolacas\b", "polonesas"),
    (r"\bpolacos\b", "poloneses"),
    (r"\butilizador\b", "usu\u00e1rio"),
    (r"\butilizadora\b", "usu\u00e1ria"),
    (r"\butilizadores\b", "usu\u00e1rios"),
    (r"\bficheiro\b", "arquivo"),
    (r"\bficheiros\b", "arquivos"),
    (r"\becr\u00e3\b", "tela"),
    (r"\becr\u00e3s\b", "telas"),
    (r"\btelem\u00f3vel\b", "celular"),
    (r"\btelem\u00f3veis\b", "celulares"),
    (r"\bautocarro\b", "\u00f4nibus"),
    (r"\bautocarros\b", "\u00f4nibus"),
    (r"\bcomboio\b", "trem"),
    (r"\bcomboios\b", "trens"),
    (r"\bcasa de banho\b", "banheiro"),
    (r"\bpequeno-almo\u00e7o\b", "caf\u00e9 da manh\u00e3"),
    (r"\brapariga\b", "garota"),
    (r"\braparigas\b", "garotas"),
    (r"\bcontacto\b", "contato"),
    (r"\bcontactos\b", "contatos"),
    (r"\bac\u00e7\u00e3o\b", "a\u00e7\u00e3o"),
    (r"\bac\u00e7\u00f5es\b", "a\u00e7\u00f5es"),
    (r"\bteu\b", "seu"),
    (r"\btua\b", "sua"),
    (r"\bteus\b", "seus"),
    (r"\btuas\b", "suas"),
]

logging.basicConfig(
    level=logging.INFO,
    format="[BookTLocalAI] %(asctime)s %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

walenty_dictionary = WalentyDictionary(WALENTY_ROOT)

logger.info("Loading Whisper model '%s' (%s/%s)...", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
logger.info("Whisper model loaded.")

polish_nlp = None
polish_dependencies = False
if stanza is not None and (STANZA_ROOT / "pl" / "pos" / "pdb_nocharlm.pt").exists():
    try:
        polish_dependencies = (
            STANZA_ROOT / "pl" / "depparse" / "pdb_nocharlm.pt"
        ).exists()
        processors = "tokenize,mwt,pos,lemma"
        packages = {
            "tokenize": "pdb",
            "mwt": "pdb",
            "pos": "pdb_nocharlm",
            "lemma": "pdb_nocharlm",
        }
        if polish_dependencies:
            processors += ",depparse"
            packages["depparse"] = "pdb_nocharlm"
        logger.info("Loading lightweight Polish models (%s)...", processors)
        polish_nlp = stanza.Pipeline(
            "pl",
            model_dir=str(STANZA_ROOT),
            processors=processors,
            package=packages,
            use_gpu=False,
            download_method=None,
            verbose=False,
        )
        logger.info("Polish morphology models loaded.")
    except Exception as exc:
        logger.warning("Polish contextual analysis unavailable: %s", exc)

french_nlp = None
if stanza is not None and (STANZA_ROOT / "fr" / "pos" / "combined_charlm.pt").exists():
    try:
        logger.info("Loading French morphology models (tokenize,mwt,pos,lemma)...")
        french_nlp = stanza.Pipeline(
            "fr",
            model_dir=str(STANZA_ROOT),
            processors="tokenize,mwt,pos,lemma",
            package="combined",
            use_gpu=False,
            download_method=None,
            verbose=False,
        )
        logger.info("French morphology models loaded.")
    except Exception as exc:
        logger.warning("French contextual analysis unavailable: %s", exc)

polish_morphology = morfeusz2.Morfeusz() if morfeusz2 is not None else None

app = Flask(__name__)


def normalize_language_code(code, default=None):
    value = (code or default or "").strip().lower().replace("_", "-")
    return LANGUAGE_ALIASES.get(value, value)


def clean_polish_lemma(lemma):
    return (lemma or "").split(":", 1)[0]


def polish_word_alternatives(word):
    if polish_morphology is None:
        return []

    alternatives = []
    seen = set()
    try:
        for _start, _end, interpretation in polish_morphology.analyse(word):
            _form, raw_lemma, tag, *_rest = interpretation
            lemma = clean_polish_lemma(raw_lemma)
            key = (lemma.casefold(), tag)
            if lemma and key not in seen:
                seen.add(key)
                alternatives.append({"lemma": lemma, "tag": tag})
    except Exception as exc:
        logger.debug("Morfeusz analysis failed for %s: %s", word, exc)
    return alternatives[:6]


def morfeusz_part_of_speech(tag):
    prefix = (tag or "").split(":", 1)[0]
    return {
        "subst": "NOUN",
        "depr": "NOUN",
        "adj": "ADJ",
        "adja": "ADJ",
        "adjp": "ADJ",
        "adv": "ADV",
        "prep": "ADP",
        "num": "NUM",
        "numcol": "NUM",
        "ppron12": "PRON",
        "ppron3": "PRON",
        "siebie": "PRON",
        "fin": "VERB",
        "bedzie": "AUX",
        "aglt": "AUX",
        "praet": "VERB",
        "impt": "VERB",
        "imps": "VERB",
        "inf": "VERB",
        "pcon": "VERB",
        "pant": "VERB",
        "ger": "NOUN",
    }.get(prefix)


def bulk_french_analyses(words):
    """Lemmatize isolated French words in ONE stanza pass.

    Running the full pipeline per word (as analyze_french_word does) takes
    ~100ms each — a page of new words blew through the Next.js timeout and
    every conjugated form fell back to lemma=itself, becoming its own lexeme.
    Batching the words as separate documents keeps per-word behavior while
    the neural models process them together.
    """
    from stanza.models.common.doc import Document

    docs = french_nlp([Document([], text=word) for word in words])
    results = []
    for word, doc in zip(words, docs):
        analyzed = [
            item
            for sentence in doc.sentences
            for token in sentence.tokens
            for item in token.words
            if item.upos != "PUNCT"
        ]
        lexical = next(
            (item for item in reversed(analyzed) if item.upos in FRENCH_LEXICAL_POS),
            analyzed[-1] if analyzed else None,
        )
        has_lexical = lexical is not None and (
            lexical.upos in FRENCH_LEXICAL_POS
            or (len(analyzed) == 1 and lexical.upos == "ADV")
        )
        results.append(
            {
                "lemma": (lexical.lemma or word).casefold() if has_lexical else word.casefold(),
                "partOfSpeech": lexical.upos if lexical is not None else None,
                "morphology": lexical.feats if lexical is not None else None,
            }
        )
    return results


def lightweight_lemma(word, language="pl"):
    normalized = normalize_language_code(language)
    result = {
        "word": word,
        "lemma": word.casefold(),
        "partOfSpeech": None,
        "morphology": None,
        "isStudyable": not bool(re.search(r"\d", word)) and len(word) <= 40,
    }
    if normalized == "fr" and french_nlp is not None:
        analysis = analyze_french_word(word)
        result.update(
            {
                "lemma": analysis.get("lemma") or result["lemma"],
                "partOfSpeech": analysis.get("partOfSpeech"),
                "morphology": analysis.get("morphology"),
            }
        )
        return result
    if normalized != "pl":
        return result

    alternatives = polish_word_alternatives(word)
    if alternatives:
        first = alternatives[0]
        result["lemma"] = first["lemma"] or result["lemma"]
        result["morphology"] = first["tag"]
        result["partOfSpeech"] = morfeusz_part_of_speech(first["tag"])
    return result


def analyze_polish_word(word, context=None):
    result = {
        "lemma": word,
        "partOfSpeech": None,
        "morphology": None,
        "caseExplanation": None,
        "alternatives": polish_word_alternatives(word),
        "analyzer": "morfeusz" if polish_morphology is not None else None,
    }
    if polish_nlp is None:
        if result["alternatives"]:
            result["lemma"] = result["alternatives"][0]["lemma"]
        return result

    try:
        document = polish_nlp(context or word)
        target = word.casefold()
        for sentence in document.sentences:
            for token in sentence.tokens:
                if token.text.casefold() != target or not token.words:
                    continue
                analyzed = next((item for item in token.words if item.upos != "PUNCT"), token.words[0])
                result.update(
                    {
                        "lemma": clean_polish_lemma(analyzed.lemma) or word,
                        "partOfSpeech": analyzed.upos,
                        "morphology": analyzed.feats,
                        "caseExplanation": (
                            explain_case(sentence, analyzed, walenty_dictionary)
                            if polish_dependencies
                            else None
                        ),
                        "analyzer": "stanza",
                    }
                )
                return result
    except Exception as exc:
        logger.warning("Contextual analysis failed for %s: %s", word, exc)
    return result


FRENCH_LEXICAL_POS = {"NOUN", "VERB", "AUX", "ADJ"}


def analyze_french_word(word, context=None):
    result = {
        "lemma": word.casefold(),
        "partOfSpeech": None,
        "morphology": None,
        "caseExplanation": None,
        "alternatives": [],
        "components": [],
        "analyzer": None,
        "translationInput": word,
    }
    if french_nlp is None:
        return result

    try:
        document = french_nlp(context or word)
        target = word.casefold().replace("’", "'")
        for sentence in document.sentences:
            tokens = sentence.tokens
            for start in range(len(tokens)):
                joined = ""
                for end in range(start, min(len(tokens), start + 4)):
                    joined += tokens[end].text.casefold().replace("’", "'")
                    if joined != target and not target.startswith(joined):
                        break
                    if joined != target:
                        continue

                    words = [
                        item
                        for token in tokens[start:end + 1]
                        for item in token.words
                        if item.upos != "PUNCT"
                    ]
                    if not words:
                        return result
                    lexical = next(
                        (item for item in reversed(words) if item.upos in FRENCH_LEXICAL_POS),
                        words[-1],
                    )
                    has_lexical_component = (
                        lexical.upos in FRENCH_LEXICAL_POS
                        or (len(words) == 1 and lexical.upos == "ADV")
                    )
                    lemma = lexical.lemma if has_lexical_component else word.casefold()
                    translation_input = lemma if has_lexical_component else word
                    if target.startswith("s'") and lexical.upos == "VERB":
                        translation_input = f"s'{lemma}"
                    elif target.startswith("n'") and lexical.upos in {"VERB", "AUX"}:
                        translation_input = f"ne pas {lemma}"
                    elif target.startswith(("c'", "s'")) and lexical.upos == "AUX":
                        translation_input = word
                    result.update(
                        {
                            "lemma": lemma or word.casefold(),
                            "partOfSpeech": lexical.upos,
                            "morphology": lexical.feats,
                            "components": [
                                {
                                    "text": item.text,
                                    "lemma": item.lemma,
                                    "partOfSpeech": item.upos,
                                    "morphology": item.feats,
                                }
                                for item in words
                            ],
                            "alternatives": [
                                {"lemma": item.lemma or item.text, "tag": item.upos}
                                for item in words
                            ],
                            "analyzer": "stanza-fr",
                            "translationInput": (
                                translation_input
                            ),
                        }
                    )
                    return result
    except Exception as exc:
        logger.warning("French contextual analysis failed for %s: %s", word, exc)
    return result


def match_case(replacement, matched_text):
    if matched_text[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def brazilianize_portuguese(text):
    translated = text
    for pattern, replacement in BRAZILIAN_PORTUGUESE_REPLACEMENTS:
        translated = re.sub(
            pattern,
            lambda match: match_case(replacement, match.group(0)),
            translated,
            flags=re.IGNORECASE,
        )
    translated = re.sub(
        r"\b(estou|está|estamos|estão|estava|estávamos|estavam) a "
        r"([a-záàâãéêíóôõúç]+(?:-se)?)\b",
        brazilian_progressive,
        translated,
        flags=re.IGNORECASE,
    )
    return translated


def brazilian_progressive(match):
    auxiliary = match.group(1)
    infinitive = match.group(2)
    reflexive = infinitive.lower().endswith("-se")
    base = infinitive[:-3] if reflexive else infinitive
    lower = base.lower()

    if lower == "ser":
        gerund = "sendo"
    elif lower == "pôr":
        gerund = "pondo"
    elif lower.endswith("ar"):
        gerund = lower[:-2] + "ando"
    elif lower.endswith("er"):
        gerund = lower[:-2] + "endo"
    elif lower.endswith("ir"):
        gerund = lower[:-2] + "indo"
    else:
        return match.group(0)

    if reflexive:
        gerund += "-se"
    return f"{auxiliary} {gerund}"


def compact_polish_lookup_translation(translation, part_of_speech, target):
    if normalize_language_code(target) != "pt" or part_of_speech != "ADJ":
        return translation

    match = re.match(
        r"^(?:(?:isto|isso|este|esta|ele|ela)\s+)?é\s+(?:(?:o|a|um|uma)\s+)?(.+?)[.!]?$",
        translation.strip(),
        flags=re.IGNORECASE,
    )
    if not match:
        return translation
    compact = match.group(1).strip()
    return compact[:1].lower() + compact[1:]


def target_language_label(target):
    if target == "pt" and TRANSLATION_VARIANT.lower().replace("_", "-") in {"pt-br", "br"}:
        return "pt-BR"
    return target


def preserve_french_leading_pronoun_gender(source_text, translation):
    source_match = re.match(
        r'^\s*[\-\u2013\u2014\u00ab"\']*\s*(elles?)\b',
        source_text or '',
        flags=re.IGNORECASE,
    )
    if not source_match:
        return translation
    target_match = re.match(
        r'^(\s*[\-\u2013\u2014\u00ab"\']*\s*)(eles?)\b',
        translation or '',
        flags=re.IGNORECASE,
    )
    if not target_match:
        return translation
    replacement = 'elas' if source_match.group(1).casefold() == 'elles' else 'ela'
    if target_match.group(2)[:1].isupper():
        replacement = replacement.capitalize()
    return target_match.group(1) + replacement + translation[target_match.end():]


def installed_translation_pairs():
    if argostranslate is None:
        return []

    pairs = []
    for from_lang in argostranslate.translate.get_installed_languages():
        for translation in getattr(from_lang, "translations_from", []):
            pairs.append(f"{translation.from_lang.code}->{translation.to_lang.code}")
    return pairs


def installed_source_languages():
    """Languages that can currently be translated to the target (direct or via English)."""
    target = normalize_language_code(TRANSLATION_TARGET)
    pairs = set(installed_translation_pairs())
    installed = {target}  # the target language needs no translation
    for lang in SUPPORTED_LANGUAGES:
        code = normalize_language_code(lang)
        if code == target:
            installed.add(code)
        elif f"{code}->{target}" in pairs:
            installed.add(code)
        elif f"{code}->en" in pairs and (target == "en" or f"en->{target}" in pairs):
            installed.add(code)
    return sorted(installed)


def install_language_packages(language):
    """Download + install the Argos packages needed to translate `language` to the
    target (direct if available, otherwise pivoting through English). Returns the
    list of newly installed pairs."""
    if argostranslate is None:
        raise RuntimeError("Argos Translate is not installed.")

    target = normalize_language_code(TRANSLATION_TARGET)
    source = normalize_language_code(language)
    if not source:
        raise ValueError("language is required")

    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    installed = set(installed_translation_pairs())
    newly = []

    def available_pkg(from_code, to_code):
        return next((p for p in available if p.from_code == from_code and p.to_code == to_code), None)

    def ensure(from_code, to_code):
        if from_code == to_code or f"{from_code}->{to_code}" in installed:
            return
        pkg = available_pkg(from_code, to_code)
        if not pkg:
            raise RuntimeError(f"Argos package not found: {from_code}->{to_code}")
        logger.info("Downloading Argos package %s->%s...", from_code, to_code)
        argostranslate.package.install_from_path(pkg.download())
        installed.add(f"{from_code}->{to_code}")
        newly.append(f"{from_code}->{to_code}")

    if source != target:
        if available_pkg(source, target):
            ensure(source, target)
        else:
            ensure(source, "en")
            if target != "en":
                ensure("en", target)
    return newly


def translate_text(text, source_language, target_language):
    if argostranslate is None:
        raise RuntimeError("Argos Translate is not installed.")

    source = normalize_language_code(source_language)
    target = normalize_language_code(target_language, TRANSLATION_TARGET)

    if not source:
        raise ValueError("language is required")
    if source == target:
        return text, source, target
    pairs = installed_translation_pairs()
    if f"{source}->{target}" in pairs:
        translation = argostranslate.translate.translate(text, source, target)
        if target_language_label(target) == "pt-BR":
            translation = brazilianize_portuguese(translation)
        if source == "fr" and target == "pt":
            translation = preserve_french_leading_pronoun_gender(text, translation)
        return translation, source, target

    if target != "en" and f"{source}->en" in pairs and f"en->{target}" in pairs:
        english_text = argostranslate.translate.translate(text, source, "en")
        translation = argostranslate.translate.translate(english_text, "en", target)
        if target_language_label(target) == "pt-BR":
            translation = brazilianize_portuguese(translation)
        if source == "fr" and target == "pt":
            translation = preserve_french_leading_pronoun_gender(text, translation)
        return translation, source, target

    if f"{source}->{target}" not in pairs:
        raise RuntimeError(
            f"Local translation package {source}->{target} is not installed. "
            "Install it with Argos Translate before using this language pair."
        )


def translation_hypotheses(text, source_language, target_language, limit=4):
    source = normalize_language_code(source_language)
    target = normalize_language_code(target_language, TRANSLATION_TARGET)
    translation = argostranslate.translate.get_translation_from_codes(source, target)
    if translation is None:
        return []

    values = []
    seen = set()
    for hypothesis in translation.hypotheses(text, limit):
        value = hypothesis.value.strip()
        if target_language_label(target) == "pt-BR":
            value = brazilianize_portuguese(value)
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            values.append(value)
    return values


def french_compositional_candidates(text, analysis):
    target = (text or "").casefold().replace("’", "'")
    features = (analysis or {}).get("morphology") or ""
    if "Definite=Ind" not in features and "PronType=Ind" not in features:
        return []

    if "Gender=Fem" in features:
        article = "uma"
    elif "Gender=Masc" in features:
        article = "um"
    else:
        return []
    if "Number=Plur" in features:
        article += "s"

    if target.startswith("d'"):
        return [f"de {article}"]
    if target.startswith("qu'"):
        return [f"que {article}"]
    return []


def comparable_words(text):
    return re.findall(r"[^\W\d_]+", (text or "").casefold(), flags=re.UNICODE)


def common_prefix_length(left, right):
    length = 0
    for a, b in zip(left, right):
        if a != b:
            break
        length += 1
    return length


def contextual_candidate_score(candidate, rank, context_translation, analysis):
    words = comparable_words(candidate)
    context_words = comparable_words(context_translation)
    score = -rank
    if not words:
        return score

    source_words = comparable_words(
        (analysis or {}).get("translationInput") or (analysis or {}).get("lemma")
    )
    if words == source_words:
        score -= 150
    source_text = ((analysis or {}).get("translationInput") or "").strip()
    if source_text[:1].islower() and candidate[:1].isupper():
        score -= 10

    candidate_phrase = " ".join(words)
    context_phrase = " ".join(context_words)
    if (
        len(candidate_phrase) >= 3
        and re.search(rf"(?:^| )({re.escape(candidate_phrase)})(?: |$)", context_phrase)
    ):
        score += 100
    elif any(
        common_prefix_length(word, context_word) >= 4
        for word in words if len(word) >= 4
        for context_word in context_words if len(context_word) >= 4
    ):
        score += 20

    part_of_speech = (analysis or {}).get("partOfSpeech")
    features = (analysis or {}).get("morphology") or ""
    word_set = set(words)
    if part_of_speech in {"VERB", "AUX"} and any(
        word.endswith(("ar", "er", "ir")) for word in words
    ):
        score += 12
    if part_of_speech in {"VERB", "AUX"} and "Tense=Imp" in features:
        if any(
            word in {"era", "eram", "estava", "estavam", "tinha", "tinham"}
            or word.endswith(("ava", "avam", "ia", "iam"))
            for word in words
        ):
            score += 16
        if word_set & {"foi", "foram"}:
            score -= 8

    if part_of_speech in {"PRON", "DET"}:
        if "Gender=Fem" in features:
            if word_set & {"ela", "elas", "a", "as", "uma", "umas"}:
                score += 120
            if word_set & {"ele", "eles", "o", "os", "um", "uns"}:
                score -= 120
        elif "Gender=Masc" in features:
            if word_set & {"ele", "eles", "o", "os", "um", "uns"}:
                score += 120
            if word_set & {"ela", "elas", "a", "as", "uma", "umas"}:
                score -= 120

        if "Definite=Ind" in features or "PronType=Ind" in features:
            score += 8 if word_set & {"um", "uma", "uns", "umas"} else 0
        elif "Definite=Def" in features:
            score += 8 if word_set & {"o", "a", "os", "as"} else 0

    return score


def select_contextual_translation(candidates, context_translation, analysis):
    if not candidates:
        return None
    ranked = sorted(
        enumerate(candidates),
        key=lambda item: contextual_candidate_score(
            item[1], item[0], context_translation, analysis
        ),
        reverse=True,
    )
    return ranked[0][1]


def compact_word_translation(translation):
    value = (translation or "").strip()
    if value.endswith(".") and not value.endswith("..."):
        value = value[:-1].rstrip()
    if len(value) > 1 and value[0].isupper() and not value[1].isupper():
        value = value[0].lower() + value[1:]
    return value


def transcribe_file(audio_path, language=None, progress_callback=None):
    language_arg = None if language == "auto" else language
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language_arg,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )
    duration = float(getattr(info, "duration", 0) or 0)
    # The generator yields segments as Whisper decodes them, so seg.end over
    # the known duration is honest transcription progress.
    segments = []
    for segment in segments_iter:
        segments.append(segment)
        if progress_callback and duration > 0:
            progress_callback(min(1.0, segment.end / duration))
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, duration, getattr(info, "language", language), segments


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "bookt-local-ai",
            "whisper_model": MODEL_SIZE,
            "compute_type": COMPUTE_TYPE,
            "translation_target": TRANSLATION_TARGET,
            "translation_variant": TRANSLATION_VARIANT,
            "translation_pairs": installed_translation_pairs(),
            "polish_nlp": polish_nlp is not None,
            "polish_dependencies": polish_dependencies,
            "polish_morphology": polish_morphology is not None,
            "french_nlp": french_nlp is not None,
            "walenty": walenty_dictionary.available,
        }
    )


@app.post("/transcribe")
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "Send audio as multipart field 'file'."}), 400

    audio_file = request.files["file"]
    suffix = Path(audio_file.filename or "audio.wav").suffix or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp.name)
        tmp_path = Path(tmp.name)

    try:
        text, duration, language, _segments = transcribe_file(tmp_path, request.form.get("language") or "pt")
        return jsonify({"text": text, "duration": round(duration, 2), "language": language})
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/align")
def align():
    payload = request.get_json(silent=True) or {}
    audio_path = payload.get("audio_path")
    pages = payload.get("pages") or []
    language = payload.get("language") or "pt"

    if not audio_path or not Path(audio_path).exists():
        return jsonify({"error": "audio_path not found"}), 400

    text, duration, detected_language, segments = transcribe_file(audio_path, language)
    alignment = build_alignment(pages, segments, duration)
    logger.info(
        "Aligned %d page(s) into %d sentence entries (%.1fs audio)",
        len(pages), len(alignment), duration,
    )
    return jsonify(
        {
            "duration": round(duration, 2),
            "language": detected_language,
            "transcript": text,
            "alignment": alignment,
        }
    )


# --- Async alignment jobs ---------------------------------------------------
# Transcribing an audiobook chapter takes minutes; a blocking request gives the
# UI nothing to show. /align-start runs the same work in a worker thread and
# /align-status reports transcription progress for a real progress bar.
import threading
import uuid

ALIGN_JOBS = {}
ALIGN_JOBS_LOCK = threading.Lock()
# Whisper is CPU-bound and the model instance is shared — one alignment at a
# time; queued jobs report their position while they wait.
ALIGN_WORK_LOCK = threading.Lock()


def _run_align_job(job_id, audio_path, pages, language):
    with ALIGN_JOBS_LOCK:
        job = ALIGN_JOBS.get(job_id)
    if job is None:
        return
    with ALIGN_WORK_LOCK:
        try:
            job["status"] = "transcribing"

            def on_progress(fraction):
                job["progress"] = round(fraction, 4)

            text, duration, detected, segments = transcribe_file(
                audio_path, language, progress_callback=on_progress
            )
            job["status"] = "aligning"
            job["progress"] = 1.0
            alignment = build_alignment(pages, segments, duration)
            logger.info(
                "Aligned %d page(s) into %d sentence entries (%.1fs audio) [job %s]",
                len(pages), len(alignment), duration, job_id,
            )
            job["result"] = {
                "duration": round(duration, 2),
                "language": detected,
                "alignment": alignment,
            }
            job["status"] = "done"
        except Exception as exc:
            logger.exception("Alignment job %s failed", job_id)
            job["status"] = "error"
            job["error"] = str(exc)


@app.post("/align-start")
def align_start():
    payload = request.get_json(silent=True) or {}
    audio_path = payload.get("audio_path")
    pages = payload.get("pages") or []
    language = payload.get("language") or "pt"

    if not audio_path or not Path(audio_path).exists():
        return jsonify({"error": "audio_path not found"}), 400

    job_id = uuid.uuid4().hex
    with ALIGN_JOBS_LOCK:
        ALIGN_JOBS[job_id] = {"status": "queued", "progress": 0.0}
    threading.Thread(
        target=_run_align_job, args=(job_id, audio_path, pages, language), daemon=True
    ).start()
    return jsonify({"job": job_id})


@app.get("/align-status/<job_id>")
def align_status(job_id):
    with ALIGN_JOBS_LOCK:
        job = ALIGN_JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "job not found"}), 404
        response = {"status": job["status"], "progress": job.get("progress", 0.0)}
        if job["status"] == "done":
            response["result"] = job.get("result")
            del ALIGN_JOBS[job_id]  # single consumption — caller persists it
        elif job["status"] == "error":
            response["error"] = job.get("error")
            del ALIGN_JOBS[job_id]
    return jsonify(response)


# A bare French infinitive pivots badly through English ("sortir" -> "Exit!"
# -> "Sai."): with no subject the pivot lands on an imperative or a noun. The
# "pour X" (in order to X) frame forces a verb reading; the Portuguese keeps an
# infinitive we can recover by stripping the light preposition.
FRENCH_INFINITIVE_PREFIX_RE = re.compile(
    r"^(?:para|pra|de|a|em|por)\s+(?:se\s+)?", re.IGNORECASE
)


def french_infinitive_translation(lemma, language, target):
    if not lemma:
        return None
    try:
        framed, _source, _target = translate_text(f"pour {lemma}", language, target)
    except Exception as exc:
        logger.debug("Framed infinitive translation failed for %s: %s", lemma, exc)
        return None
    if not framed:
        return None
    cleaned = framed.strip().rstrip(".!?").strip()
    cleaned = FRENCH_INFINITIVE_PREFIX_RE.sub("", cleaned, count=1).strip()
    # Guard against an untranslated echo ("pour sortir") or an empty result.
    if not cleaned or cleaned.casefold().startswith("pour "):
        return None
    if lemma.casefold() in cleaned.casefold().split():
        return None
    return cleaned[0].lower() + cleaned[1:] if cleaned else None


@app.post("/translate")
def translate():
    payload = request.get_json(silent=True) or {}
    text = payload.get("word") or payload.get("text") or ""
    context = (payload.get("context") or "").strip()
    is_word_lookup = bool(payload.get("word"))
    language = payload.get("language") or payload.get("from") or "pl"
    target = payload.get("target") or payload.get("to") or TRANSLATION_TARGET

    if not text:
        return jsonify({"error": "text is required"}), 400

    source_code = normalize_language_code(language)
    target_code = normalize_language_code(target, TRANSLATION_TARGET)

    analysis = None
    translation_input = text
    if is_word_lookup and context and source_code == "pl":
        analysis = analyze_polish_word(text, context)
        translation_input = analysis["lemma"] or text
        if analysis.get("partOfSpeech") == "ADJ":
            translation_input = f"To jest {translation_input}."
    elif is_word_lookup and source_code == "fr":
        analysis = analyze_french_word(text, context)
        translation_input = analysis.get("translationInput") or text

    # Closed-class words first: MT on an isolated pronoun/article is unreliable
    # (the English pivot drops gender/person — "elle" -> "it" -> "ele"), so a
    # curated glossary answers these before MT is tried.
    glossary_translation = None
    if is_word_lookup and source_code != "fr" and " " not in text.strip():
        glossary_translation = (
            glossary_lookup(text, source_code, target_code)
            or glossary_lookup((analysis or {}).get("lemma") or "", source_code, target_code)
        )

    try:
        context_translation = None
        if context:
            context_translation, _context_source, _context_target = translate_text(context, language, target)

        contextual_hypotheses = []
        # A bare verb infinitive (no sentence to disambiguate) is the backfill
        # case — frame it so the pivot reads it as a verb instead of a command.
        verb_infinitive = (
            is_word_lookup and source_code == "fr" and not context
            and (analysis or {}).get("partOfSpeech") in ("VERB", "AUX")
            and translation_input == (analysis or {}).get("lemma")
        )
        if glossary_translation is not None:
            translation, source, target = glossary_translation, source_code, target_code
        elif verb_infinitive:
            framed = french_infinitive_translation(translation_input, language, target)
            if framed is not None:
                translation, source, target = framed, source_code, target_code
            else:
                translation, source, target = translate_text(translation_input, language, target)
        elif is_word_lookup and source_code == "fr":
            contextual_hypotheses = translation_hypotheses(
                translation_input, source_code, target_code
            )
            contextual_hypotheses = list(dict.fromkeys(
                french_compositional_candidates(text, analysis) + contextual_hypotheses
            ))
            translation = select_contextual_translation(
                contextual_hypotheses, context_translation, analysis
            )
            source, target = source_code, target_code
            if translation is None:
                translation, source, target = translate_text(translation_input, language, target)
        else:
            translation, source, target = translate_text(translation_input, language, target)
            translation = compact_polish_lookup_translation(
                translation,
                (analysis or {}).get("partOfSpeech"),
                target,
            )
    except Exception as exc:
        logger.warning("Translation failed: %s", exc)
        return jsonify({"error": str(exc)}), 503

    if is_word_lookup:
        translation = compact_word_translation(translation)

    lemma_translation = None
    if source_code == "fr" and analysis and analysis.get("lemma"):
        lemma = analysis["lemma"]
        if translation_input == lemma or (
            translation_input.startswith("s'") and analysis.get("partOfSpeech") == "VERB"
        ):
            lemma_translation = translation
        elif translation_input.startswith("ne pas "):
            lemma_translation = re.sub(
                r"^n[aã]o\s+", "", translation, count=1, flags=re.IGNORECASE
            ) or None

    return jsonify(
        {
            "word": text,
            "translation": translation,
            "meanings": [] if analysis else [{"meaning": translation, "partOfSpeech": ""}],
            "ipa": None,
            "lemma": (analysis or {}).get("lemma"),
            "lemmaTranslation": lemma_translation,
            "partOfSpeech": (analysis or {}).get("partOfSpeech"),
            "morphology": (analysis or {}).get("morphology"),
            "caseExplanation": (analysis or {}).get("caseExplanation"),
            "alternatives": (analysis or {}).get("alternatives", []),
            "translationAlternatives": contextual_hypotheses,
            "contextTranslation": context_translation,
            "sourceLanguage": source,
            "targetLanguage": target_language_label(target),
            "engine": (
                "glossary" if glossary_translation is not None
                else "argos-context+stanza-fr" if source_code == "fr" and analysis
                else "argos+" + analysis["analyzer"] if analysis and analysis.get("analyzer")
                else "argos"
            ),
        }
    )


@app.get("/languages")
def languages():
    return jsonify(
        {
            "target": normalize_language_code(TRANSLATION_TARGET),
            "supported": SUPPORTED_LANGUAGES,
            "installed": installed_source_languages(),
        }
    )


@app.post("/lemmatize")
def lemmatize():
    payload = request.get_json(silent=True) or {}
    words = payload.get("words") or []
    language = payload.get("language") or "pl"
    if not isinstance(words, list):
        return jsonify({"error": "words must be a list"}), 400

    unique = list(dict.fromkeys(str(word).strip() for word in words if str(word).strip()))[:500]
    normalized = normalize_language_code(language)

    if normalized == "fr" and french_nlp is not None and unique:
        base = [lightweight_lemma(word, "en") for word in unique]  # word/isStudyable shell
        try:
            for entry, analysis in zip(base, bulk_french_analyses(unique)):
                entry.update(analysis)
        except Exception as exc:
            logger.warning("Bulk French lemmatization failed: %s", exc)
        return jsonify({"language": normalized, "words": base})

    return jsonify(
        {
            "language": normalized,
            "words": [lightweight_lemma(word, language) for word in unique],
        }
    )


# --- Verb conjugation (verbecc) -------------------------------------------
# Tenses drilled by the flashcards conjugation trainer, in teaching order.
CONJUGATION_TENSES = {
    "fr": [
        {"mood": "indicatif", "tense": "présent", "label": "Présent"},
        {"mood": "indicatif", "tense": "imparfait", "label": "Imparfait"},
        {"mood": "indicatif", "tense": "futur-simple", "label": "Futur simple"},
        {"mood": "indicatif", "tense": "passé-composé", "label": "Passé composé"},
    ],
}

_conjugators = {}


def get_conjugator(lang):
    if lang not in _conjugators:
        from verbecc import CompleteConjugator

        logger.info("Loading %s conjugation models (verbecc)...", lang)
        _conjugators[lang] = CompleteConjugator(lang)
    return _conjugators[lang]


def conjugation_forms(items):
    """Normalize verbecc person entries to the six canonical drill rows."""
    canonical = [("1", "s"), ("2", "s"), ("3", "s"), ("1", "p"), ("2", "p"), ("3", "p")]
    forms = []
    for person, number in canonical:
        entry = next(
            (
                item
                for item in items
                if item.get_person() == person and item.get_number() == number
                and item.get_gender() in (None, "", "m")
            ),
            None,
        )
        conjugations = entry.get_conjugations() if entry is not None else None
        if not conjugations:
            return None
        full = conjugations[0]
        pronoun = entry.get_pronoun()
        if full.startswith(f"{pronoun} "):
            value = full[len(pronoun) + 1:]
        elif pronoun == "je" and full.startswith("j'"):
            pronoun, value = "j'", full[2:]
        else:
            value = full
        forms.append({"person": pronoun, "value": value, "full": full})
    return forms


@app.post("/conjugate")
def conjugate():
    payload = request.get_json(silent=True) or {}
    verb = (payload.get("verb") or "").strip().casefold()
    language = normalize_language_code(payload.get("language") or "fr")

    if not verb:
        return jsonify({"error": "verb is required"}), 400
    tenses = CONJUGATION_TENSES.get(language)
    if not tenses:
        return jsonify({"error": f"conjugation not supported for {language}"}), 400

    try:
        conjugator = get_conjugator(language)
    except Exception as exc:
        logger.exception("Conjugator load failed")
        return jsonify({"error": str(exc)}), 500

    results = []
    for spec in tenses:
        try:
            items = conjugator.conjugate_mood_tense(verb, spec["mood"], spec["tense"])
        except Exception as exc:
            logger.info("Conjugation failed for %s (%s): %s", verb, spec["tense"], exc)
            return jsonify({"error": f"verb not found: {verb}"}), 404
        forms = conjugation_forms(items)
        if forms:
            results.append({**spec, "forms": forms})

    if not results:
        return jsonify({"error": f"verb not found: {verb}"}), 404
    return jsonify({"verb": verb, "language": language, "tenses": results})


@app.post("/install-language")
def install_language():
    payload = request.get_json(silent=True) or {}
    language = payload.get("language")
    if not language:
        return jsonify({"error": "language is required"}), 400
    try:
        newly = install_language_packages(language)
        return jsonify(
            {
                "language": normalize_language_code(language),
                "installedPairs": newly,
                "installed": installed_source_languages(),
            }
        )
    except Exception as exc:
        logger.exception("Language install failed")
        return jsonify({"error": str(exc)}), 500


# Windows SAPI culture per language (best-effort; requires the voice installed).
TTS_CULTURES = {
    "pt": "pt-BR", "en": "en-US", "fr": "fr-FR", "es": "es-ES", "de": "de-DE",
    "it": "it-IT", "ru": "ru-RU", "ja": "ja-JP", "zh": "zh-CN", "ko": "ko-KR",
    "nl": "nl-NL", "pl": "pl-PL",
}


@app.post("/tts")
def tts():
    payload = request.get_json(silent=True) or {}
    text = payload.get("text") or payload.get("word") or ""
    language = payload.get("language") or "en"

    if not text:
        return jsonify({"error": "text is required"}), 400

    culture = TTS_CULTURES.get(normalize_language_code(language), "en-US")

    with tempfile.TemporaryDirectory() as tmp_dir:
        text_path = Path(tmp_dir) / "input.txt"
        wav_path = Path(tmp_dir) / "speech.wav"
        text_path.write_text(text, encoding="utf-8")

        ps = f"""
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath {json.dumps(str(text_path))} -Raw
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Culture.Name -eq {json.dumps(culture)} }} | Select-Object -First 1
if ($voice) {{ $synth.SelectVoice($voice.VoiceInfo.Name) }}
$synth.SetOutputToWaveFile({json.dumps(str(wav_path))})
$synth.Speak($text)
$synth.Dispose()
"""
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            check=True,
            timeout=30,
            capture_output=True,
        )

        data = wav_path.read_bytes()
        return send_file(io.BytesIO(data), mimetype="audio/wav", download_name="speech.wav")


if __name__ == "__main__":
    logger.info("Starting BookT local AI service on http://%s:%s", HOST, PORT)
    app.run(host=HOST, port=PORT, threaded=False)
