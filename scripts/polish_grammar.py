"""Polish case explanations built from Stanza dependencies and Walenty frames."""

import logging
import re
from collections import defaultdict
from pathlib import Path


logger = logging.getLogger(__name__)

CASE_LABELS = {
    "Nom": "nominativo",
    "Gen": "genitivo",
    "Dat": "dativo",
    "Acc": "acusativo",
    "Ins": "instrumental",
    "Loc": "locativo",
    "Voc": "vocativo",
}

STANZA_TO_WALENTY_CASE = {
    "Nom": "nom",
    "Gen": "gen",
    "Dat": "dat",
    "Acc": "acc",
    "Ins": "inst",
    "Loc": "loc",
    "Voc": "voc",
}

PREPOSITION_GUIDANCE = {
    ("w", "Loc"): "quando indica localização ou situação em algo",
    ("w", "Acc"): "quando indica movimento para dentro ou em direção a algo",
    ("na", "Loc"): "quando indica localização, superfície ou contexto",
    ("na", "Acc"): "quando indica destino, direção ou finalidade",
    ("z", "Ins"): "quando significa companhia ou associação, como 'com'",
    ("z", "Gen"): "quando indica origem, afastamento ou parte de algo",
    ("o", "Loc"): "quando introduz o assunto de que se fala ou pensa",
    ("o", "Acc"): "em usos que indicam contato, pedido ou medida",
    ("do", "Gen"): "quando indica direção, destino ou relação com algo",
    ("od", "Gen"): "quando indica origem, distância ou separação",
    ("dla", "Gen"): "quando indica beneficiário ou finalidade",
    ("bez", "Gen"): "quando significa ausência, como 'sem'",
    ("u", "Gen"): "quando indica proximidade, posse ou estar na casa de alguém",
    ("przy", "Loc"): "quando indica proximidade ou circunstância",
    ("po", "Loc"): "quando indica percurso, distribuição ou algo posterior",
    ("po", "Acc"): "em construções de quantidade ou busca por algo",
    ("przez", "Acc"): "quando indica passagem, causa ou agente",
    ("ku", "Dat"): "quando indica direção",
    ("dzięki", "Dat"): "quando significa 'graças a'",
    ("przeciw", "Dat"): "quando indica oposição",
    ("przeciwko", "Dat"): "quando indica oposição",
    ("przed", "Ins"): "quando indica posição anterior ou diante de algo",
    ("za", "Ins"): "quando indica posição atrás, troca ou papel",
    ("za", "Acc"): "quando indica movimento para trás de algo ou duração",
    ("nad", "Ins"): "quando indica posição acima ou trabalho sobre algo",
    ("nad", "Acc"): "quando indica movimento para uma posição acima de algo",
    ("pod", "Ins"): "quando indica posição abaixo de algo",
    ("pod", "Acc"): "quando indica movimento para baixo de algo",
    ("między", "Ins"): "quando indica posição entre elementos",
    ("między", "Acc"): "quando indica movimento para uma posição entre elementos",
}

NP_RE = re.compile(r"(?<![a-z])np\((str|pred|part|nom|gen|dat|acc|inst|loc)\)")
PREPNP_RE = re.compile(
    r"(?<![a-z])prepnp\(([^,()]+),(str|pred|part|nom|gen|dat|acc|inst|loc)\)"
)


def feature_map(features):
    result = {}
    for item in (features or "").split("|"):
        if "=" in item:
            key, value = item.split("=", 1)
            result[key] = value
    return result


def split_top_level(value):
    parts = []
    start = 0
    round_depth = curly_depth = square_depth = 0
    for index, char in enumerate(value):
        if char == "(":
            round_depth += 1
        elif char == ")":
            round_depth = max(0, round_depth - 1)
        elif char == "{":
            curly_depth += 1
        elif char == "}":
            curly_depth = max(0, curly_depth - 1)
        elif char == "[":
            square_depth += 1
        elif char == "]":
            square_depth = max(0, square_depth - 1)
        elif char == "+" and round_depth == curly_depth == square_depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
    parts.append(value[start:].strip())
    return [part for part in parts if part]


class WalentyDictionary:
    """Small in-memory index of Walenty frames keyed by verbal lemma."""

    def __init__(self, root):
        self.root = Path(root)
        self.frames = defaultdict(list)
        self.source_file = None
        self._load()

    @property
    def available(self):
        return bool(self.source_file and self.frames)

    def _load(self):
        candidates = sorted(self.root.rglob("walenty_*_verbs_verified.txt"), reverse=True)
        if not candidates:
            logger.info("Walenty dictionary not found under %s", self.root)
            return

        self.source_file = candidates[0]
        with self.source_file.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line or line.startswith("%"):
                    continue
                fields = line.rstrip("\n").split(": ", 5)
                if len(fields) != 6:
                    continue
                lemma, opinion, _frame_id, _meaning, aspect, frame = fields
                if opinion == "zły":
                    continue
                self.frames[lemma].append(
                    {"opinion": opinion, "aspect": aspect, "frame": frame}
                )
        logger.info(
            "Loaded Walenty: %d verbal lemmas from %s",
            len(self.frames),
            self.source_file,
        )

    def match(self, lemma, observed_case, preposition=None, relation="", aspect=None, negated=False, reflexive=False):
        wanted = STANZA_TO_WALENTY_CASE.get(observed_case)
        if not wanted:
            return None

        best = None
        lookup_lemmas = [f"{lemma} się", lemma] if reflexive else [lemma]
        entries = (
            (matched_lemma, entry)
            for matched_lemma in lookup_lemmas
            for entry in self.frames.get(matched_lemma, [])
        )
        for matched_lemma, entry in entries:
            frame = entry["frame"]
            frame_reflexive = bool(re.search(r"\{\s*refl\s*\}", frame))
            for position in split_top_level(frame):
                label = position.split("{", 1)[0].strip()
                if "subj" in label and not relation.startswith("nsubj"):
                    continue
                if relation.startswith("nsubj") and "subj" not in label:
                    continue

                requirements = []
                if preposition:
                    for prep, required_case in PREPNP_RE.findall(position):
                        if prep.strip(" '") == preposition:
                            requirements.append(required_case)
                else:
                    requirements.extend(NP_RE.findall(position))

                for required_case in requirements:
                    case_score = self._case_score(required_case, wanted, negated)
                    if case_score < 0:
                        continue
                    score = case_score
                    if relation.startswith("obj") and "obj" in label:
                        score += 4
                    if relation.startswith("obj") and required_case == "str":
                        # Walenty's structural object is the canonical source
                        # for accusative and genitive-under-negation. Prefer it
                        # over case mentions nested inside idiomatic arguments.
                        score += 4
                    if entry["opinion"] == "pewny":
                        score += 3
                    elif entry["opinion"] == "wątpliwy":
                        score -= 2
                    if aspect and entry["aspect"] == aspect:
                        score += 2
                    if reflexive == frame_reflexive:
                        score += 1
                    elif reflexive and not frame_reflexive:
                        score -= 2

                    candidate = {
                        "score": score,
                        "lemma": matched_lemma,
                        "requiredCase": required_case,
                        "opinion": entry["opinion"],
                        "aspect": entry["aspect"],
                    }
                    if best is None or candidate["score"] > best["score"]:
                        best = candidate
        return best

    @staticmethod
    def _case_score(required, observed, negated):
        if required == observed:
            return 10
        if required == "str":
            if observed == "acc" and not negated:
                return 8
            if observed == "gen" and negated:
                return 8
        if required == "part" and observed in {"acc", "gen"}:
            return 7
        return -1


def _word_by_id(sentence, word_id):
    if not word_id:
        return None
    return next((word for word in sentence.words if word.id == word_id), None)


def _children(sentence, word):
    return [candidate for candidate in sentence.words if candidate.head == word.id]


def _nearest_verb(sentence, word):
    current = word
    visited = set()
    while current and current.id not in visited:
        visited.add(current.id)
        if current.upos in {"VERB", "AUX"}:
            return current
        current = _word_by_id(sentence, current.head)
    return None


def _preposition_for(sentence, word):
    candidates = [
        child for child in _children(sentence, word)
        if child.upos == "ADP" or (child.deprel or "").startswith("case")
    ]
    return candidates[0] if candidates else None


def _sentence_is_negated(sentence, verb):
    for child in _children(sentence, verb):
        features = feature_map(child.feats)
        if child.lemma == "nie" or child.text.casefold() == "nie" or features.get("Polarity") == "Neg":
            return True
    return False


def _sentence_is_reflexive(sentence, verb):
    reflexives = {"się", "siebie", "sobie", "sobą"}
    return any(
        (word.lemma or word.text).casefold() in reflexives
        and (word.head == verb.id or _nearest_verb(sentence, word) == verb)
        for word in sentence.words
    )


def _verb_aspect(verb):
    aspect = feature_map(verb.feats).get("Aspect")
    return {"Imp": "imperf", "Perf": "perf"}.get(aspect)


def _payload(case, reason, pattern, trigger, source, confidence="high"):
    return {
        "case": case,
        "caseLabel": CASE_LABELS[case],
        "reason": reason,
        "pattern": pattern,
        "trigger": trigger,
        "source": source,
        "confidence": confidence,
    }


def _explain_nominal_case(sentence, word, walenty):
    features = feature_map(word.feats)
    case = features.get("Case")
    if case not in CASE_LABELS:
        return None
    case_label = CASE_LABELS[case]
    relation = word.deprel or ""

    preposition = _preposition_for(sentence, word)
    if preposition:
        prep = (preposition.lemma or preposition.text).casefold()
        guidance = PREPOSITION_GUIDANCE.get((prep, case))
        detail = f", {guidance}," if guidance else ", neste uso,"
        return _payload(
            case,
            f'A preposição “{preposition.text}”{detail} rege o {case_label}.',
            f"{prep} + {case_label}",
            {"text": preposition.text, "lemma": prep, "type": "preposition"},
            "regra de preposição",
        )

    if case == "Voc":
        return _payload(
            case,
            f'“{word.text}” está no vocativo porque é uma forma de chamar ou se dirigir diretamente a alguém.',
            "chamamento + vocativo",
            {"text": word.text, "lemma": word.lemma, "type": "construction"},
            "regra gramatical",
        )

    if relation.startswith("nsubj") and case == "Nom":
        governor = _nearest_verb(sentence, word)
        trigger = governor or word
        return _payload(
            case,
            f'“{word.text}” está no nominativo porque funciona como sujeito da oração.',
            "sujeito + nominativo",
            {"text": trigger.text, "lemma": trigger.lemma, "type": "verb" if governor else "construction"},
            "estrutura da frase",
        )

    head = _word_by_id(sentence, word.head)
    if relation.startswith("nmod") and case == "Gen" and head and head.upos in {"NOUN", "PROPN"}:
        return _payload(
            case,
            f'“{word.text}” completa o substantivo “{head.text}”. O genitivo costuma marcar relações equivalentes a “de” em português.',
            "substantivo + genitivo",
            {"text": head.text, "lemma": head.lemma, "type": "noun"},
            "estrutura da frase",
        )

    governor = _nearest_verb(sentence, word)
    if governor and walenty and walenty.available:
        lemma = governor.lemma or governor.text.casefold()
        negated = _sentence_is_negated(sentence, governor)
        match = walenty.match(
            lemma,
            case,
            relation=relation,
            aspect=_verb_aspect(governor),
            negated=negated,
            reflexive=_sentence_is_reflexive(sentence, governor),
        )
        if match:
            matched_lemma = match.get("lemma", lemma)
            if match["requiredCase"] == "str" and case == "Gen" and negated:
                reason = (
                    f'O objeto de “{governor.text}” aparece no genitivo porque o verbo está negado; '
                    "nessa construção, a negação substitui o acusativo estrutural pelo genitivo."
                )
                pattern = f"nie + {matched_lemma} + genitivo"
            elif match["requiredCase"] == "str" and case == "Acc":
                reason = (
                    f'“{word.text}” é o objeto direto afirmativo de “{governor.text}” '
                    "e, por isso, usa o acusativo."
                )
                pattern = f"{matched_lemma} + acusativo"
            else:
                reason = (
                    f'“{word.text}” é um complemento de “{governor.text}” ({matched_lemma}). '
                    f"Esse verbo admite um complemento no {case_label}."
                )
                pattern = f"{matched_lemma} + {case_label}"
            confidence = "medium" if match["opinion"] == "wątpliwy" else "high"
            return _payload(
                case,
                reason,
                pattern,
                {"text": governor.text, "lemma": matched_lemma, "type": "verb"},
                "Walenty",
                confidence,
            )

    generic = {
        ("obj", "Acc"): f'“{word.text}” funciona como objeto direto e, nesta frase afirmativa, usa o acusativo.',
        ("iobj", "Dat"): f'“{word.text}” funciona como complemento indireto ou destinatário e usa o dativo.',
        ("obl", "Ins"): f'“{word.text}” é um complemento circunstancial no instrumental.',
        ("obl", "Loc"): f'“{word.text}” é um complemento circunstancial no locativo.',
    }
    relation_base = relation.split(":", 1)[0]
    reason = generic.get((relation_base, case))
    if reason:
        trigger = governor or word
        return _payload(
            case,
            reason,
            f"{relation_base} + {case_label}",
            {"text": trigger.text, "lemma": trigger.lemma, "type": "verb" if governor else "construction"},
            "estrutura da frase",
            "medium",
        )

    return _payload(
        case,
        f'O Stanza identificou “{word.text}” no {case_label}, mas a estrutura não permite apontar um único gatilho com segurança.',
        case_label,
        None,
        "análise morfológica",
        "low",
    )


def explain_case(sentence, selected, walenty=None):
    """Return a pedagogical explanation for the selected inflected word."""
    if not sentence or not selected:
        return None

    if selected.upos == "ADP":
        governed = _word_by_id(sentence, selected.head)
        if governed:
            return _explain_nominal_case(sentence, governed, walenty)
        return None

    features = feature_map(selected.feats)
    case = features.get("Case")
    if case not in CASE_LABELS:
        return None

    head = _word_by_id(sentence, selected.head)
    if (
        selected.upos in {"ADJ", "DET", "NUM", "PRON"}
        and (selected.deprel or "").split(":", 1)[0] in {"amod", "det", "nummod"}
        and head
        and head.upos in {"NOUN", "PROPN", "PRON"}
    ):
        base = _explain_nominal_case(sentence, head, walenty)
        if base:
            base["reason"] = (
                f'“{selected.text}” está no {CASE_LABELS[case]} porque concorda com '
                f'“{head.text}” em caso, gênero e número. {base["reason"]}'
            )
            base["agreementWith"] = {"text": head.text, "lemma": head.lemma}
            return base

    return _explain_nominal_case(sentence, selected, walenty)
