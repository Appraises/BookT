import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from polish_grammar import WalentyDictionary, explain_case


def word(word_id, text, lemma, upos, feats, head, deprel):
    return SimpleNamespace(
        id=word_id,
        text=text,
        lemma=lemma,
        upos=upos,
        feats=feats,
        head=head,
        deprel=deprel,
    )


class PolishGrammarTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        dictionary = Path(self.temp_dir.name) / "walenty_20180726_verbs_verified.txt"
        dictionary.write_text(
            "\n".join(
                [
                    "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)}",
                    "widzieć: pewny: _: : imperf: subj{np(str)} + obj{np(str)} + obj{lex(np(gen),sg,'oko',natr)}",
                    "interesować się: pewny: _: : imperf: subj{np(str)} + {np(inst)}",
                ]
            ),
            encoding="utf-8",
        )
        self.walenty = WalentyDictionary(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_matches_explicit_genitive_government(self):
        match = self.walenty.match(
            "szukać", "Gen", relation="obj", aspect="imperf"
        )
        self.assertEqual(match["requiredCase"], "gen")

    def test_prefers_structural_case_for_negated_object(self):
        match = self.walenty.match(
            "widzieć",
            "Gen",
            relation="obj",
            aspect="imperf",
            negated=True,
        )
        self.assertEqual(match["requiredCase"], "str")

    def test_uses_reflexive_dictionary_lemma(self):
        match = self.walenty.match(
            "interesować",
            "Ins",
            relation="obl:arg",
            aspect="imperf",
            reflexive=True,
        )
        self.assertEqual(match["lemma"], "interesować się")

    def test_explains_preposition_and_case(self):
        sentence = SimpleNamespace(
            words=[
                word(1, "Mówię", "mówić", "VERB", "Aspect=Imp", 0, "root"),
                word(2, "o", "o", "ADP", None, 3, "case"),
                word(3, "książce", "książka", "NOUN", "Case=Loc|Number=Sing", 1, "obl:arg"),
            ]
        )
        explanation = explain_case(sentence, sentence.words[2], self.walenty)
        self.assertEqual(explanation["pattern"], "o + locativo")
        self.assertEqual(explanation["confidence"], "high")

    def test_explains_adjective_agreement(self):
        sentence = SimpleNamespace(
            words=[
                word(1, "Szukam", "szukać", "VERB", "Aspect=Imp", 0, "root"),
                word(2, "dobrej", "dobry", "ADJ", "Case=Gen|Gender=Fem|Number=Sing", 3, "amod"),
                word(3, "książki", "książka", "NOUN", "Case=Gen|Gender=Fem|Number=Sing", 1, "obj"),
            ]
        )
        explanation = explain_case(sentence, sentence.words[1], self.walenty)
        self.assertIn("concorda com", explanation["reason"])
        self.assertEqual(explanation["pattern"], "szukać + genitivo")


if __name__ == "__main__":
    unittest.main()
