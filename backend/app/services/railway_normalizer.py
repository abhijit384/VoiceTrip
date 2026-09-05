import re
from typing import Dict, List, Optional, Any, Tuple
from app.core.railway_vocabulary import (
    STATIONS,
    CANONICAL_STATION_NAMES,
    STATION_CODE_MAP,
    STATION_NAME_MAP,
    RAILWAY_TERMS,
    ACOUSTIC_PHONETIC_CORRECTIONS,
)
from app.models.travel import TravelIntent


class NormalizedTranscriptResult:
    def __init__(
        self,
        raw_text: str,
        normalized_text: str,
        corrections: List[Dict[str, str]],
        intent: TravelIntent,
    ):
        self.raw_text = raw_text
        self.normalized_text = normalized_text
        self.corrections = corrections
        self.intent = intent

    @property
    def entities(self) -> Dict[str, Any]:
        return {
            "origin": self.intent.origin,
            "destination": self.intent.destination,
            "date": self.intent.travel_date,
            "time_constraint": self.intent.time_constraint,
            "passengers": self.intent.passengers,
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "normalized_text": self.normalized_text,
            "corrections": self.corrections,
            "intent": self.intent.model_dump(),
        }


class RailwayDomainNormalizer:
    """
    Context-aware normalization layer that maps raw STT transcripts
    into precise railway domain entities and terminology.
    Preserves ordinary English words unless contextual cues warrant domain normalization.
    """

    # Explicit railway / travel keywords (strictly travel-specific terms)
    RAILWAY_KEYWORDS = re.compile(
        r"\b(train|trains|station|stations|travel|travelling|booking|tickets?|platform|boarding|departures?|arrivals?|journey|pnr|berth|coach|tatkal|sleeper|rajdhani|shatabdi|duronto|vande bharat|express)\b",
        re.IGNORECASE,
    )

    # Known ambiguous phonemes that require confirmation if isolated
    AMBIGUOUS_PHONETIC_PAIRS = [
        (r"\b(?:an|and|end|in)\s+jp\b", "NJP", "New Jalpaiguri (NJP)"),
        (r"\bhaura\b", "HWH", "Howrah (HWH)"),
        (r"\bsialdah\b", "SDAH", "Sealdah (SDAH)"),
    ]

    def is_railway_context(self, text: str) -> bool:
        """
        Determines if the utterance is within railway/travel context.
        Checks for explicit railway terminology, prepositions + station names, or journey verbs.
        """
        if not text:
            return False
        lowered = text.lower()
        if self.RAILWAY_KEYWORDS.search(lowered):
            return True
        for term in RAILWAY_TERMS:
            if re.search(rf"\b{re.escape(term)}\b", lowered):
                return True
        for stn in CANONICAL_STATION_NAMES:
            if len(stn) >= 3 and re.search(rf"\b{re.escape(stn)}\b", lowered):
                return True
        # Check travel verbs: "go to", "reach", "travel from", "book", "leave for"
        if re.search(r"\b(go to|reach|travel from|leave for|head to|want to go)\b", lowered):
            return True
        return False

    def normalize(self, raw_text: str, prior_intent: Optional[TravelIntent] = None) -> NormalizedTranscriptResult:
        """
        Executes context-aware normalization without destroying raw transcript:
        1. Evaluates travel context
        2. Applies acoustic/phonetic corrections with audit log
        3. Normalizes canonical station aliases and casing
        4. Extracts structured TravelIntent (merging with prior context if follow-up)
        """
        if not raw_text or not raw_text.strip():
            empty_intent = prior_intent or TravelIntent(intent="unknown")
            return NormalizedTranscriptResult(
                raw_text=raw_text or "",
                normalized_text=raw_text or "",
                corrections=[],
                intent=empty_intent,
            )

        text = raw_text.strip()
        corrections: List[Dict[str, str]] = []
        is_contextual = self.is_railway_context(text)

        # Stage 1: Contextual Acoustic & Phonetic Corrections
        for pattern, replacement, req_context, desc in ACOUSTIC_PHONETIC_CORRECTIONS:
            if req_context:
                has_immediate_preposition = bool(re.search(rf"\b(?:from|to|at|towards|via|for|reach|go\s+from|station\s+(?:is|at)?)\s+{pattern}", text, re.IGNORECASE))
                has_immediate_station_suffix = bool(re.search(rf"{pattern}\s+(?:station|junction|express|train)", text, re.IGNORECASE))

                # Do NOT convert ordinary English (like 'me and jp walked home') without travel context or prepositions
                if not (has_immediate_preposition or has_immediate_station_suffix or is_contextual):
                    continue

            def replace_match(match):
                orig = match.group(0)
                if orig.lower() != replacement.lower():
                    corrections.append({
                        "from": orig,
                        "to": replacement,
                        "rule": "phonetic_acoustic_match",
                        "description": desc,
                    })
                return replacement

            new_text, count = re.subn(pattern, replace_match, text, flags=re.IGNORECASE)
            if count > 0:
                text = new_text

        # Stage 2: Canonical Station Name and Term Casing
        for lower_name, canonical in CANONICAL_STATION_NAMES.items():
            pattern = rf"\b{re.escape(lower_name)}\b"
            def fix_case(match):
                orig = match.group(0)
                if orig != canonical and orig.lower() == canonical.lower():
                    corrections.append({
                        "from": orig,
                        "to": canonical,
                        "rule": "canonical_casing",
                        "description": f"Standardize casing '{orig}' -> '{canonical}'",
                    })
                return canonical

            text = re.sub(pattern, fix_case, text, flags=re.IGNORECASE)

        # Stage 3: Normalize whitespace and sentence capitalization
        text = re.sub(r"\s+", " ", text).strip()
        if text and text[0].islower():
            text = text[0].upper() + text[1:]

        # Stage 4: Extract Structured Travel Intent with conversational memory
        intent = self.extract_travel_intent(text, prior_intent=prior_intent)

        return NormalizedTranscriptResult(
            raw_text=raw_text,
            normalized_text=text,
            corrections=corrections,
            intent=intent,
        )

    def resolve_station_code(self, name: Optional[str]) -> Optional[str]:
        """Resolves station name or alias to official IRCTC station code (e.g. 'Howrah' -> 'HWH')."""
        if not name:
            return None
        cleaned = name.lower().strip()
        # Strip trailing prepositions/punctuation if any
        cleaned = re.sub(r"^(?:from|to|station|the)\s+", "", cleaned)
        cleaned = re.sub(r"\s+(?:station|junction|railway)$", "", cleaned)

        if cleaned in STATION_CODE_MAP:
            return STATION_CODE_MAP[cleaned]
        for code, data in STATIONS.items():
            if cleaned == code.lower() or cleaned == data["name"].lower():
                return code
            for alias in data.get("aliases", []):
                if cleaned == alias.lower():
                    return code
        return None

    def resolve_display_name(self, code_or_name: Optional[str]) -> Optional[str]:
        """Returns pretty display name for station code (e.g. 'NJP' -> 'New Jalpaiguri (NJP)')."""
        if not code_or_name:
            return None
        code = self.resolve_station_code(code_or_name)
        if code and code in STATION_NAME_MAP:
            return STATION_NAME_MAP[code]
        return code_or_name

    def extract_travel_intent(self, text: str, prior_intent: Optional[TravelIntent] = None) -> TravelIntent:
        """
        Extracts structured travel parameters (origin, destination, date, time_constraint, passengers).
        Handles conversational follow-ups (e.g. 'Actually, make that morning' preserves origin/dest).
        Detects ambiguous locations and triggers clarification questions.
        """
        lowered = text.lower()

        origin: Optional[str] = None
        destination: Optional[str] = None
        travel_date: Optional[str] = None
        time_constraint: Optional[str] = None
        passengers: int = 1
        needs_clarification: bool = False
        clarification_question: Optional[str] = None

        # Check for conversational follow-up / barge-in cues
        is_follow_up = bool(re.search(r"\b(actually|make that|change|switch to|only|instead|what about|how about)\b", lowered))

        # Date extraction
        if "day after tomorrow" in lowered:
            travel_date = "day after tomorrow"
        elif "tomorrow" in lowered:
            travel_date = "tomorrow"
        elif "today" in lowered:
            travel_date = "today"
        elif "tonight" in lowered:
            travel_date = "today"
            time_constraint = "night"

        # Time constraint extraction
        if "morning" in lowered:
            time_constraint = "morning"
        elif "evening" in lowered:
            time_constraint = "evening"
        elif "afternoon" in lowered:
            time_constraint = "afternoon"
        elif "night" in lowered:
            time_constraint = "night"

        # Passenger extraction
        pass_match = re.search(r"\b(\d+)\s+(?:passengers?|seats?|tickets?|people|persons?)\b", lowered)
        if pass_match:
            try:
                passengers = max(1, int(pass_match.group(1)))
            except Exception:
                passengers = 1

        # Destination change pattern: "Change destination to Sealdah", "switch destination to SDAH"
        change_dest_match = re.search(r"\b(?:change|switch|make)\s+(?:the\s+)?destination\s+to\s+([A-Za-z\s]+?)(?:\s+(?:tomorrow|today|in\s+the|at|on)|\.|$)", text, re.IGNORECASE)
        if change_dest_match:
            cand_dest = change_dest_match.group(1).strip()
            destination = self.resolve_station_code(cand_dest) or cand_dest

        # Origin change pattern: "Change origin to NJP", "travel from Howrah instead"
        change_orig_match = re.search(r"\b(?:change|switch|make)\s+(?:the\s+)?origin\s+to\s+([A-Za-z\s]+?)(?:\s+(?:tomorrow|today|in\s+the|at|on)|\.|$)", text, re.IGNORECASE)
        if change_orig_match:
            cand_orig = change_orig_match.group(1).strip()
            origin = self.resolve_station_code(cand_orig) or cand_orig

        # Standard Prepositional Route Patterns
        if not origin and not destination:
            is_travel_ctx = self.is_railway_context(text)

            # Pattern 1: "from <ORIGIN> to <DESTINATION>"
            from_to_match = re.search(
                r"\bfrom\s+([A-Za-z\s\.]+?)\s+to\s+([A-Za-z\s\.]+?)(?:\s+(?:trains?|flights?|bus(?:es)?|tomorrow|today|tonight|in\s+the|at|on|for|this|next|morning|evening|afternoon|night)|[\.,\?!]|$)",
                text,
                re.IGNORECASE,
            )
            if from_to_match:
                cand_orig = from_to_match.group(1).strip()
                cand_dest = from_to_match.group(2).strip()
                res_orig = self.resolve_station_code(cand_orig)
                res_dest = self.resolve_station_code(cand_dest)
                if is_travel_ctx or (res_orig and res_dest):
                    origin = res_orig or cand_orig
                    destination = res_dest or cand_dest

            # Pattern 1b: "<ORIGIN> to <DESTINATION>" (without "from", common in speech)
            # Handles: "Kolkata to Delhi trains tonight?", "NJP to Howrah tomorrow"
            if not origin and not destination:
                city_to_city_match = re.search(
                    r"\b([A-Za-z][A-Za-z\s\.]{1,25}?)\s+to\s+([A-Za-z][A-Za-z\s\.]{1,25}?)(?:\s+(?:trains?|flights?|bus(?:es)?|tomorrow|today|tonight|in\s+the|at|on|for|this|next|morning|evening|afternoon|night)|[\.,\?!]|$)",
                    text,
                    re.IGNORECASE,
                )
                if city_to_city_match:
                    cand_orig = city_to_city_match.group(1).strip()
                    cand_dest = city_to_city_match.group(2).strip()
                    # Only accept if both look like station/city names (not generic English like "want to go")
                    res_orig = self.resolve_station_code(cand_orig)
                    res_dest = self.resolve_station_code(cand_dest)
                    if (res_orig and res_dest) or (is_travel_ctx and (res_orig or res_dest)):
                        origin = res_orig or cand_orig
                        destination = res_dest or cand_dest

            # Pattern 2: "between <ORIGIN> and <DESTINATION>"
            if not origin or not destination:
                between_match = re.search(
                    r"\bbetween\s+([A-Za-z\s\.]+?)\s+and\s+([A-Za-z\s\.]+?)(?:\s+(?:tomorrow|today|in\s+the|at|on)|\.|$)",
                    text,
                    re.IGNORECASE,
                )
                if between_match:
                    cand_orig = between_match.group(1).strip()
                    cand_dest = between_match.group(2).strip()
                    res_orig = self.resolve_station_code(cand_orig)
                    res_dest = self.resolve_station_code(cand_dest)
                    if is_travel_ctx or (res_orig and res_dest):
                        origin = res_orig or cand_orig
                        destination = res_dest or cand_dest

            # Pattern 3: "trains from <ORIGIN>" or "to <DESTINATION>"
            if not origin:
                from_match = re.search(r"\b(?:travel\s+)?from\s+([A-Za-z\s\.]+?)(?:\s+(?:tomorrow|today|to|in\s+the|at|on|for|morning|evening)|\.|$)", text, re.IGNORECASE)
                if from_match:
                    cand_orig = from_match.group(1).strip()
                    res_orig = self.resolve_station_code(cand_orig)
                    if is_travel_ctx or res_orig:
                        origin = res_orig or cand_orig

            if not destination:
                to_match = re.search(r"\b(?:travel\s+)?to\s+([A-Za-z\s\.]+?)(?:\s+(?:trains?|flights?|bus(?:es)?|tomorrow|today|tonight|from|in\s+the|at|on|for|morning|evening|afternoon|night)|[\.,\?!]|$)", text, re.IGNORECASE)
                if to_match:
                    cand_dest = to_match.group(1).strip()
                    res_dest = self.resolve_station_code(cand_dest)
                    if is_travel_ctx or res_dest:
                        destination = res_dest or cand_dest

        # Pattern 4: "The station is <STATION>" / "station is <STATION>"
        if not origin:
            station_is_match = re.search(r"\b(?:the\s+)?station\s+is\s+([A-Za-z\s\.]+?)(?:\.|$)", text, re.IGNORECASE)
            if station_is_match:
                cand_stn = station_is_match.group(1).strip()
                res_stn = self.resolve_station_code(cand_stn)
                if res_stn:
                    origin = res_stn

        # Direct Code Mention: e.g. "I want to travel from NJP"
        if not origin:
            for code in ["NJP", "HWH", "SDAH", "NDLS", "KGP", "BWN", "DGR", "ASN", "MLDT", "PNBE", "GHY", "RNC", "BBS", "KOAA", "DLI"]:
                if re.search(rf"\bfrom\s+{code}\b", text, re.IGNORECASE):
                    origin = code
                    break
        if not destination:
            for code in ["NJP", "HWH", "SDAH", "NDLS", "KGP", "BWN", "DGR", "ASN", "MLDT", "PNBE", "GHY", "RNC", "BBS", "KOAA", "DLI"]:
                if re.search(rf"\bto\s+{code}\b", text, re.IGNORECASE):
                    destination = code
                    break

        # Merge with Prior Conversation Context if this is a follow-up / barge-in
        if prior_intent:
            if not origin and (is_follow_up or time_constraint or travel_date or destination):
                origin = prior_intent.origin
            if not destination and (is_follow_up or time_constraint or travel_date or origin):
                destination = prior_intent.destination
            if not travel_date:
                travel_date = prior_intent.travel_date
            if not time_constraint and is_follow_up:
                time_constraint = prior_intent.time_constraint

        # Default fallbacks
        travel_date = travel_date or "tomorrow"
        time_constraint = time_constraint or "any"

        # Determine if utterance is train-specific vs general travel
        is_train_query = any(w in text.lower() for w in ["train", "trains", "railway", "irctc", "rail", "shatabdi", "rajdhani", "vande bharat"]) or (
            prior_intent and prior_intent.intent == "train_search" and not any(w in text.lower() for w in ["flight", "hotel", "stay", "pack", "places to visit", "plan"])
        )

        # Ambiguity Check: Only apply station validation for explicit train searches
        if is_train_query:
            if origin and origin not in STATIONS:
                for code, data in STATIONS.items():
                    if code.lower() in origin.lower() or data["name"].lower() in origin.lower():
                        origin = code
                        break
                else:
                    needs_clarification = True
                    clarification_question = f"Did you mean {origin} as your departure station?"

            if destination and destination not in STATIONS:
                for code, data in STATIONS.items():
                    if code.lower() in destination.lower() or data["name"].lower() in destination.lower():
                        destination = code
                        break
                else:
                    needs_clarification = True
                    clarification_question = f"Did you mean {destination} as your destination station?"

        # Intent classification for fallback
        intent_type = "general_travel"
        if any(w in text.lower() for w in ["flight", "flights", "fly", "plane"]):
            intent_type = "flight_search"
        elif any(w in text.lower() for w in ["hotel", "hotels", "stay", "resort"]):
            intent_type = "hotel_search"
        elif any(w in text.lower() for w in ["places to visit", "best places", "what to see", "attractions"]):
            intent_type = "destination_info"
        elif any(w in text.lower() for w in ["plan", "itinerary"]):
            intent_type = "itinerary_planning"
        elif any(w in text.lower() for w in ["pack", "packing", "what to wear"]):
            intent_type = "travel_advice"
        elif any(w in text.lower() for w in ["how to travel", "how to get", "route", "how to reach"]):
            intent_type = "route_search"
        elif is_train_query or (origin and destination and (origin in STATIONS or destination in STATIONS)):
            intent_type = "train_search"

        return TravelIntent(
            intent=intent_type,
            origin=origin,
            destination=destination,
            date=travel_date,
            time_constraint=time_constraint,
            passengers=passengers,
            needs_clarification=needs_clarification,
            clarification_question=clarification_question,
        )


railway_normalizer = RailwayDomainNormalizer()
