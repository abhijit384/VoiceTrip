import re
import difflib
import logging
from typing import Dict, List, Optional, Tuple, Any
from pydantic import BaseModel

logger = logging.getLogger("transcript-corrector")


class CorrectionItem(BaseModel):
    original: str
    corrected: str
    confidence: float
    correction_type: str  # "exact", "alias", "phonetic", "fuzzy"
    entity_type: str  # "city", "station", "airport", "travel_term"


class CorrectionResult(BaseModel):
    raw_transcript: str
    corrected_transcript: str
    was_corrected: bool
    corrections: List[CorrectionItem] = []
    requires_clarification: bool = False
    clarification_prompt: Optional[str] = None
    extracted_entities: Dict[str, Optional[str]] = {}


# ==============================================================================
# Domain Vocabulary & Dictionaries
# ==============================================================================

# Canonical Cities supported across travel modes
CANONICAL_CITIES: Dict[str, str] = {
    "delhi": "Delhi",
    "new delhi": "Delhi",
    "kolkata": "Kolkata",
    "calcutta": "Kolkata",
    "mumbai": "Mumbai",
    "bombay": "Mumbai",
    "bangalore": "Bangalore",
    "bengaluru": "Bengaluru",
    "chennai": "Chennai",
    "madras": "Chennai",
    "hyderabad": "Hyderabad",
    "pune": "Pune",
    "goa": "Goa",
    "jaipur": "Jaipur",
    "howrah": "Howrah",
    "sealdah": "Sealdah",
    "siliguri": "Siliguri",
    "darjeeling": "Darjeeling",
    "new jalpaiguri": "New Jalpaiguri",
    "ahmedabad": "Ahmedabad",
    "varanasi": "Varanasi",
    "lucknow": "Lucknow",
    "chandigarh": "Chandigarh",
    "agra": "Agra",
    "kochi": "Kochi",
    "cochin": "Kochi",
}

# Known Common Speech-to-Text Phonetic Aliases / Misspellings -> Canonical Name
PHONETIC_ALIASES: Dict[str, str] = {
    # Delhi variations
    "delhee": "Delhi",
    "delly": "Delhi",
    "dilli": "Delhi",
    "dehli": "Delhi",
    "deli": "Delhi",
    "delee": "Delhi",
    # Kolkata variations
    "kolkatta": "Kolkata",
    "kolkatha": "Kolkata",
    "kolkotha": "Kolkata",
    "kalkatta": "Kolkata",
    "culcutta": "Kolkata",
    # Mumbai variations
    "mumbaii": "Mumbai",
    "mumbay": "Mumbai",
    "mumbae": "Mumbai",
    "bombae": "Mumbai",
    # Bangalore variations
    "banglore": "Bangalore",
    "bangaluru": "Bengaluru",
    "bengalooru": "Bengaluru",
    # Chennai variations
    "chenai": "Chennai",
    "chennay": "Chennai",
    # Hyderabad variations
    "hydrabad": "Hyderabad",
    "hyderbad": "Hyderabad",
    # Pune variations
    "poona": "Pune",
    "poonah": "Pune",
    # Jaipur variations
    "jaipoor": "Jaipur",
    "jeypore": "Jaipur",
    # New Jalpaiguri / NJP variations
    "njp": "NJP",
    "an jp": "NJP",
    "and jp": "NJP",
    "end jp": "NJP",
    "in jp": "NJP",
    "new jalpaigudi": "New Jalpaiguri",
    "jalpaiguri": "New Jalpaiguri",
    # Howrah / Sealdah variations
    "haura": "Howrah",
    "howra": "Howrah",
    "howrah": "Howrah",
    "sialdah": "Sealdah",
    "sealdha": "Sealdah",
    "seldah": "Sealdah",
    "sdah": "Sealdah",
    # Goa variations
    "gova": "Goa",
}

# General Travel Terms Normalization
TRAVEL_TERM_NORMALIZATION: Dict[str, str] = {
    "flite": "flight",
    "flites": "flights",
    "flyt": "flight",
    "flyts": "flights",
    "hotle": "hotel",
    "hotles": "hotels",
    "resort": "hotel",
    "trainz": "trains",
    "traine": "train",
    "tikets": "tickets",
    "tiket": "ticket",
    "tkt": "ticket",
    "tkts": "tickets",
}

# Non-Travel / Conversational Keywords to Guard Against False Corrections
NON_TRAVEL_CUES = [
    r"^(?:hi|hello|hey|good\s+morning|good\s+evening|good\s+afternoon)\b",
    r"^(?:what\s+can\s+you\s+do|who\s+are\s+you|what\s+is\s+your\s+name|help|what\s+are\s+your\s+features)\b",
    r"\b(?:what\s+is\s+python|tell\s+me\s+a\s+joke|how\s+are\s+you|explain\s+machine\s+learning|who\s+is|what\s+is)\b",
    r"^(?:thanks|thank\s+you|bye|goodbye|cool|awesome|great|nice|ok|okay)\b",
]

# Explicit Travel Intent Triggers
TRAVEL_TRIGGERS = [
    r"\b(?:train|trains|flight|flights|hotel|hotels|stay|bus|buses|route|routes|cab|travel|trip|journey|destination|visit|go\s+to|reach|leave\s+for|from|to|tonight|tomorrow|today)\b"
]


class TranscriptCorrectionService:
    """
    Production-grade, safe, deterministic transcript correction layer.
    Corrects STT misspellings and phonetic errors for travel entities
    while strictly avoiding modifications to valid cities or non-travel conversation.
    """

    FUZZY_CONFIDENCE_THRESHOLD = 0.84

    def __init__(self):
        # Build set of all valid canonical entity names in lower case
        self.canonical_entities_lower = set(CANONICAL_CITIES.keys())

    def is_conversational_only(self, text: str) -> bool:
        """Determines if the utterance is purely general/conversational and should skip travel correction."""
        clean = text.strip().lower()
        # If it matches strong non-travel cues and has no travel keywords
        has_non_travel_cue = any(re.search(pat, clean, re.IGNORECASE) for pat in NON_TRAVEL_CUES)
        has_travel_cue = any(re.search(pat, clean, re.IGNORECASE) for pat in TRAVEL_TRIGGERS)

        if has_non_travel_cue and not has_travel_cue:
            return True
        return False

    def find_fuzzy_match(self, word: str) -> Optional[Tuple[str, float]]:
        """
        Finds the highest confidence match in known canonical cities using SequenceMatcher.
        Only returns match if confidence exceeds threshold and word length >= 3.
        """
        w_lower = word.lower().strip()
        if len(w_lower) < 3:
            return None

        # Exact match check
        if w_lower in CANONICAL_CITIES:
            return (CANONICAL_CITIES[w_lower], 1.0)

        # Check known aliases first (highest precision)
        if w_lower in PHONETIC_ALIASES:
            return (PHONETIC_ALIASES[w_lower], 0.95)

        # Fuzzy match against canonical list
        best_match = None
        best_score = 0.0

        for cand, canonical_name in CANONICAL_CITIES.items():
            # Never match if word lengths differ drastically
            if abs(len(w_lower) - len(cand)) > 3:
                continue
            ratio = difflib.SequenceMatcher(None, w_lower, cand).ratio()
            if ratio > best_score:
                best_score = ratio
                best_match = canonical_name

        if best_score >= self.FUZZY_CONFIDENCE_THRESHOLD and best_match:
            return (best_match, round(best_score, 3))

        return None

    def correct_transcript(self, raw_text: str) -> CorrectionResult:
        """
        Main entry point for transcript correction:
        1. Preserves non-travel utterances untouched.
        2. Applies conservative word-level & multi-word phrase corrections for travel entities.
        3. Never turns a valid city into an unrelated station/city.
        4. Returns both raw and corrected transcripts with full audit trail.
        """
        if not raw_text or not raw_text.strip():
            return CorrectionResult(
                raw_transcript=raw_text or "",
                corrected_transcript=raw_text or "",
                was_corrected=False,
                corrections=[],
            )

        text = raw_text.strip()

        # Step 1: Skip travel correction for general conversational queries
        if self.is_conversational_only(text):
            logger.info(f"[CORRECTOR] Skipped travel correction for general utterance: '{text}'")
            return CorrectionResult(
                raw_transcript=raw_text,
                corrected_transcript=text,
                was_corrected=False,
                corrections=[],
            )

        corrections: List[CorrectionItem] = []
        working_text = text

        # Step 2: Multi-word alias normalization (e.g. "an jp" -> "NJP", "new jalpaigudi" -> "New Jalpaiguri")
        for alias, canonical in PHONETIC_ALIASES.items():
            if " " in alias:
                pattern = rf"\b{re.escape(alias)}\b"
                if re.search(pattern, working_text, re.IGNORECASE):
                    def replace_alias(m):
                        orig = m.group(0)
                        if orig != canonical:
                            corrections.append(CorrectionItem(
                                original=orig,
                                corrected=canonical,
                                confidence=0.95,
                                correction_type="alias",
                                entity_type="city_or_station",
                            ))
                        return canonical
                    working_text = re.sub(pattern, replace_alias, working_text, flags=re.IGNORECASE)

        # Step 3: Travel terms normalization (flite -> flight, hotle -> hotel)
        for misspelled, correct_term in TRAVEL_TERM_NORMALIZATION.items():
            pattern = rf"\b{re.escape(misspelled)}\b"
            if re.search(pattern, working_text, re.IGNORECASE):
                def replace_term(m):
                    orig = m.group(0)
                    corrections.append(CorrectionItem(
                        original=orig,
                        corrected=correct_term,
                        confidence=0.98,
                        correction_type="phonetic",
                        entity_type="travel_term",
                    ))
                    return correct_term
                working_text = re.sub(pattern, replace_term, working_text, flags=re.IGNORECASE)

        # Step 4: Word-by-word token analysis for single-word aliases and high-confidence fuzzy matching
        words = re.findall(r"\b[\w'-]+\b|[^\w\s]", working_text)
        corrected_tokens: List[str] = []

        # Track location context cues (e.g. "from [word]", "to [word]", "in [word]")
        prev_word = ""

        for idx, token in enumerate(words):
            clean_token = token.lower().strip()
            # If punctuation or non-alphanumeric, keep as is
            if not token.isalnum():
                corrected_tokens.append(token)
                continue

            # Context cues: words preceded by "from", "to", "in", "at", "reach", "between"
            is_location_slot = prev_word in ["from", "to", "in", "at", "reach", "between", "near", "for"]

            # Rule A: Check if word is already an exact valid canonical city or common English word
            if clean_token in CANONICAL_CITIES:
                canonical_cased = CANONICAL_CITIES[clean_token]
                if token != canonical_cased:
                    corrections.append(CorrectionItem(
                        original=token,
                        corrected=canonical_cased,
                        confidence=1.0,
                        correction_type="exact",
                        entity_type="city",
                    ))
                    corrected_tokens.append(canonical_cased)
                else:
                    corrected_tokens.append(token)
                prev_word = clean_token
                continue

            # Rule B: Check known phonetic alias dictionary
            if clean_token in PHONETIC_ALIASES:
                target_name = PHONETIC_ALIASES[clean_token]
                corrections.append(CorrectionItem(
                    original=token,
                    corrected=target_name,
                    confidence=0.95,
                    correction_type="alias",
                    entity_type="city",
                ))
                corrected_tokens.append(target_name)
                prev_word = clean_token
                continue

            # Rule C: Fuzzy matching ONLY for likely location slots or words that closely match known cities
            fuzzy_res = self.find_fuzzy_match(clean_token)
            if fuzzy_res:
                target_name, score = fuzzy_res
                # If high score (>0.88) or location slot with >=0.84 score
                if score >= 0.88 or (is_location_slot and score >= self.FUZZY_CONFIDENCE_THRESHOLD):
                    corrections.append(CorrectionItem(
                        original=token,
                        corrected=target_name,
                        confidence=score,
                        correction_type="fuzzy",
                        entity_type="city",
                    ))
                    corrected_tokens.append(target_name)
                    prev_word = clean_token
                    continue

            # No safe correction -> retain user's exact original token
            corrected_tokens.append(token)
            prev_word = clean_token

        # Rebuild text cleanly preserving punctuation spacing
        reconstructed = ""
        for i, tok in enumerate(corrected_tokens):
            if i == 0:
                reconstructed += tok
            elif not tok.isalnum():
                reconstructed += tok
            elif not reconstructed[-1].isalnum() and reconstructed[-1] not in ["'", '"', '-']:
                reconstructed += " " + tok
            else:
                reconstructed += " " + tok

        reconstructed = re.sub(r"\s+([,.?!])", r"\1", reconstructed).strip()
        if reconstructed and reconstructed[0].islower():
            reconstructed = reconstructed[0].upper() + reconstructed[1:]

        was_corrected = (reconstructed.lower() != raw_text.strip().lower())

        # Step 5: Extract structured entities for fast path validation
        entities = self._extract_quick_entities(reconstructed)

        logger.info(
            f"[AUTOCORRECT] Raw: '{raw_text}' -> Corrected: '{reconstructed}' "
            f"(changed={was_corrected}, corrections={len(corrections)})"
        )

        return CorrectionResult(
            raw_transcript=raw_text,
            corrected_transcript=reconstructed,
            was_corrected=was_corrected,
            corrections=corrections,
            extracted_entities=entities,
        )

    def _extract_quick_entities(self, text: str) -> Dict[str, Optional[str]]:
        """Extracts origin and destination from corrected text deterministically."""
        entities: Dict[str, Optional[str]] = {
            "origin": None,
            "destination": None,
            "mode": None,
        }

        # Travel Mode
        t_low = text.lower()
        if "train" in t_low or "rail" in t_low:
            entities["mode"] = "train"
        elif "flight" in t_low or "fly" in t_low or "plane" in t_low:
            entities["mode"] = "flight"
        elif "hotel" in t_low or "stay" in t_low or "resort" in t_low:
            entities["mode"] = "hotel"
        elif "bus" in t_low:
            entities["mode"] = "bus"

        # Pattern: from [Origin] to [Destination]
        m_from_to = re.search(r"\bfrom\s+([A-Za-z\s]+?)\s+to\s+([A-Za-z\s]+?)(?:\s+(?:on|tomorrow|today|tonight|this|in|at)|\?|\.|$)", text, re.IGNORECASE)
        if m_from_to:
            orig = m_from_to.group(1).strip()
            dest = m_from_to.group(2).strip()
            entities["origin"] = CANONICAL_CITIES.get(orig.lower(), orig)
            entities["destination"] = CANONICAL_CITIES.get(dest.lower(), dest)
            return entities

        # Pattern: [Origin] to [Destination] (e.g. "Kolkata to Delhi trains")
        m_to = re.search(r"\b([A-Za-z]+)\s+to\s+([A-Za-z]+)", text, re.IGNORECASE)
        if m_to:
            orig = m_to.group(1).strip()
            dest = m_to.group(2).strip()
            if orig.lower() in CANONICAL_CITIES or dest.lower() in CANONICAL_CITIES:
                entities["origin"] = CANONICAL_CITIES.get(orig.lower(), orig)
                entities["destination"] = CANONICAL_CITIES.get(dest.lower(), dest)
                return entities

        # Pattern: hotels in [Destination] / visit [Destination]
        m_in = re.search(r"\b(?:in|at|around|for)\s+([A-Za-z\s]+?)(?:\s+(?:tomorrow|today|tonight|this|\d+)|\?|\.|$)", text, re.IGNORECASE)
        if m_in:
            dest = m_in.group(1).strip()
            entities["destination"] = CANONICAL_CITIES.get(dest.lower(), dest)

        return entities


# Singleton instance
transcript_corrector = TranscriptCorrectionService()
