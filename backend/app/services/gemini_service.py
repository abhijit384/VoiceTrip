import time
import json
import logging
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from google import genai
from google.genai import types

from app.core.config import settings
from app.models.travel import TravelIntent, CanonicalTravelContext
from app.services.railway_normalizer import railway_normalizer

logger = logging.getLogger("gemini-service")

ALLOWED_TOOL_INTENTS = {
    "hotel_search", "flight_search", "train_search", "route_search",
    "bus_search", "destination_info",
}

SYSTEM_VOICE_PROMPT = """You are VoiceTrip, a friendly, intelligent, and natural voice assistant with specialized expertise in travel planning.
You are speaking directly to the user over a live voice call.

CRITICAL VOICE & CONVERSATIONAL GUIDELINES:
1. Speak concisely in 1 to 3 conversational, friendly sentences maximum.
2. Never format with markdown, bullet points, asterisks, bold text, markdown tables, or emojis.
3. For general conversation, greetings, humor, or general knowledge (e.g. Python, machine learning, science, geography, jokes, weather), answer naturally, accurately, and concisely.
4. NEVER invent flight numbers, train numbers, hotel availability, prices, departure times, or booking status.
5. SPOKEN RESULT RULES FOR SUMMARIZING SEARCH / TOOL RESULTS:
   - When tool results are present, speak a complete, natural spoken summary of ALL relevant options returned and displayed in the UI (e.g. all 4 flights, all 4 trains, or all 4 hotels).
   - For each option, include its key identifying details concisely:
     * Flights: airline/flight name, departure time, and price.
     * Trains: train name, departure time, and fare.
     * Hotels: hotel name, price per night, and rating.
     * Routes/Buses: mode/operator, departure time, duration, and fare.
   - Do NOT drop options or speak only the first result. Summarize all displayed options compactly in natural conversational sentences.
   - Ground spoken answers ONLY in information contained in the actual tool results. Never invent prices or details.
   - Do NOT read internal JSON, IDs, request IDs, generation IDs, or tool metadata.
   - Do NOT call results "demo" in spoken responses.
6. If a question is general travel knowledge (e.g. trip advice, packing tips, best time to visit, weather), answer directly and conversationally without calling search tools.
7. If a required detail is missing or ambiguous (e.g. 'Show me some' with no other context), ask a concise 1-sentence clarification.
"""

CANONICAL_INTENT_SYSTEM_PROMPT = """You are the Intent Classification and Canonical Context Engine for VoiceTrip, a conversational voice assistant specialized in travel.
Your task is to analyze the user's latest utterance in relation to PREVIOUS_CANONICAL_CONTEXT and determine:
1. intent: One of ["greeting", "conversational", "unclear", "train_search", "flight_search", "hotel_search", "bus_search", "route_search", "destination_info", "itinerary_planning", "travel_advice", "general_travel"]
2. request_type: "NEW" or "FOLLOW_UP"
3. Structured travel fields (origin, destination, travel_date, time_constraint, passengers, budget, sort_by, location_preference) ONLY when intent is a travel search.

RULES:
A. GREETING:
   - User says standalone "hello", "hi", "hey", "good morning", "good evening", etc.
   - intent = "greeting", request_type = "NEW", no travel fields.

B. CONVERSATIONAL / GENERAL (NON-TRAVEL):
   - User asks general questions ("how are you", "what can you do", "who are you", "what is Python", "explain machine learning", "tell me a joke", "what is the capital of France", "thanks", "bye", etc.).
   - intent = "conversational", request_type = "NEW", no travel fields.
   - NEVER classify general, technical, or conversational questions as travel.

C. TRAVEL REQUEST:
   - User initiates a travel search ("find hotels in Delhi", "flights from Kolkata to Delhi", "show trains from NJP to Howrah", "bus from Mumbai to Pune", "accommodations in Goa").
   - intent = appropriate travel intent ("hotel_search", "flight_search", "train_search", "route_search", "destination_info", etc.), request_type = "NEW".

D. TRAVEL FOLLOW-UP & SHORT ANSWERS (CRITICAL):
   - When PREVIOUS_CANONICAL_CONTEXT has an active travel search AND user is refining, modifying, or answering a question:
     - Date answer ("tomorrow", "today", "tonight", "what about tomorrow?", "Friday", "day after tomorrow"): update travel_date, request_type = "FOLLOW_UP", preserve intent, origin, destination.
     - Mode switch/confirmation ("search flights", "flights", "check trains", "trains", "hotels"): update intent, request_type = "FOLLOW_UP", preserve origin, destination.
     - Filter answer ("which one is cheapest?", "cheapest", "cheaper ones", "only morning", "under 5000"): update sort_by, time_constraint, budget, request_type = "FOLLOW_UP", preserve route.
     - Passenger answer ("two", "for two", "3 people"): update passengers, request_type = "FOLLOW_UP".
     - City answer ("Delhi", "Mumbai"): fill missing origin/destination, request_type = "FOLLOW_UP".
   - NEVER classify short answers like "Tomorrow" or "Search flights" as general conversation or greeting when an active travel context exists! Preserve all unchanged fields from PREVIOUS_CANONICAL_CONTEXT.

E. UNCLEAR / AMBIGUOUS:
   - User says something vague without sufficient context ("show me some", "which one", "change it").
   - intent = "unclear", needs_clarification = true, clarification_question = "Sure — what would you like me to help you find?".

Output MUST strictly conform to the CanonicalTravelContext schema.
"""


class ToolCall(BaseModel):
    name: str
    arguments: Dict[str, Any]
    id: Optional[str] = None


class LLMResponse(BaseModel):
    content: Optional[str] = None
    tool_calls: List[ToolCall] = []
    intent: Optional[TravelIntent] = None
    canonical_context: Optional[CanonicalTravelContext] = None
    latency_ms: int = 0
    model: str = "gemini-3.6-flash"
    provider: str = "gemini"


class GeminiService:
    """
    Dedicated LLM Service integrating Google Gemini 3.6 Flash via the official `google-genai` SDK.
    Provides canonical conversation state resolution, multi-turn follow-ups, and concise voice summaries.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.model = model or settings.GEMINI_MODEL or "gemini-3.6-flash"
        self.is_configured = bool(
            self.api_key and "your_gemini" not in self.api_key and len(self.api_key) > 5
        )
        self._client: Optional[genai.Client] = None
        if self.is_configured:
            try:
                self._client = genai.Client(api_key=self.api_key)
                logger.info(f"GeminiService initialized with model: {self.model}")
            except Exception as e:
                logger.error(f"Failed to initialize Google GenAI client: {e}")
                self._client = None

    def _is_follow_up_phrase(self, text: str) -> bool:
        """Heuristic check for follow-up / modification / refinement intent."""
        lowered = text.lower().strip()
        follow_up_cues = [
            r"\bactually\b",
            r"\binstead\b",
            r"\bmake it\b",
            r"\bmake that\b",
            r"\bchange\b",
            r"\bswitch\b",
            r"\bonly\b",
            r"\balso\b",
            r"\bremove\b",
            r"\badd\b",
            r"\bfor\s+(?:two|three|four|\d+)\b",
            r"\btomorrow\s+instead\b",
            r"\bmorning\s+instead\b",
            r"\bevening\s+instead\b",
            r"\bnight\s+instead\b",
            r"\bcheaper\b",
            r"\bcheapest\b",
            r"\blowest\s+price\b",
            r"\bleast\s+expensive\b",
            r"\bclosest\b",
            r"\bcity\s+center\b",
            r"\bclosest\s+to\b",
            r"\bmore\s+options\b",
            r"\bshow\s+(?:me\s+)?more\b",
            r"\bmore\b",
            r"\bother\s+options\b",
            r"\bnext\s+options\b",
            r"\bbest\s+rated\b",
            r"\bhighest\s+rated\b",
            r"\bbest\b",
            r"\bfaster\b",
            r"\bunder\s+\d+\b",
            r"\bbelow\s+\d+\b",
            r"\bless\s+than\b",
            r"\bwhat\s+about\b",
            r"\bwhich\s+of\s+these\b",
            r"\bwhich\s+(?:one\s+)?is\b",
        ]
        return any(re.search(pat, lowered) for pat in follow_up_cues)

    def _extract_known_destination(self, text: str) -> Optional[str]:
        """Extracts known Indian travel destination or city from text."""
        lowered = text.lower()
        known_cities = [
            ("new delhi", "Delhi"),
            ("delhi", "Delhi"),
            ("south mumbai", "Mumbai"),
            ("mumbai", "Mumbai"),
            ("bombay", "Mumbai"),
            ("south goa", "Goa"),
            ("north goa", "Goa"),
            ("goa", "Goa"),
            ("jaipur", "Jaipur"),
            ("kolkata", "Kolkata"),
            ("calcutta", "Kolkata"),
            ("bangalore", "Bangalore"),
            ("bengaluru", "Bangalore"),
            ("chennai", "Chennai"),
            ("madras", "Chennai"),
            ("hyderabad", "Hyderabad"),
            ("darjeeling", "Darjeeling"),
            ("srinagar", "Kashmir"),
            ("kashmir", "Kashmir"),
            ("gangtok", "Sikkim"),
            ("sikkim", "Sikkim"),
            ("kerala", "Kerala"),
            ("manali", "Manali"),
            ("shimla", "Shimla"),
            ("ladakh", "Ladakh"),
            ("leh", "Ladakh"),
            ("pune", "Pune"),
            ("agra", "Agra"),
            ("varanasi", "Varanasi"),
            ("amritsar", "Amritsar"),
            ("ooty", "Ooty"),
            ("udaipur", "Udaipur"),
        ]
        for key, canonical in known_cities:
            if re.search(rf"\b{key}\b", lowered):
                return canonical
        return None

    def _clean_city_token(self, token: Optional[str]) -> Optional[str]:
        """Cleans and canonicalizes an extracted city/station token string."""
        if not token:
            return None
        t = token.strip()
        # Remove common action and preposition noise prefixes
        t = re.sub(
            r"^(?:from|to|for|at|in|near|around|the|a|an|search|find|show|book|check|get|look up|flights?|trains?|bus(?:es)?|cab|tickets?)\s+",
            "",
            t,
            flags=re.IGNORECASE,
        )
        # Remove trailing mode/time noise suffixes
        t = re.sub(
            r"\s+(?:flights?|fly|trains?|rail|bus(?:es)?|tomorrow|today|tonight|please|now|tickets?)$",
            "",
            t,
            flags=re.IGNORECASE,
        )
        t = t.strip(" ,.?!'\"")
        if not t or len(t) < 2:
            return None
        if t.lower() in ["me", "us", "you", "him", "her", "them", "here", "there", "somewhere", "anywhere", "what", "where", "how", "when", "why", "city", "place", "airport", "station"]:
            return None
        # Check canonical city mapping
        canonical = self._extract_known_destination(t)
        if canonical:
            return canonical
        # Check station code
        stn = railway_normalizer.resolve_station_code(t)
        if stn:
            return stn
        return t.title()

    def _extract_explicit_route(self, text: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Extracts origin and destination from explicit route utterances for ANY cities or stations.
        Cleans commas, semicolons, and prefixes ('search', 'find', 'flights', etc.).
        """
        # Normalize punctuation: replace commas, semicolons, extra spaces
        clean = re.sub(r"[,;]+", " ", text)
        clean = re.sub(r"\s+", " ", clean).strip()

        # Pattern 1: "from <ORIGIN> to <DESTINATION>"
        m_from_to = re.search(
            r"\bfrom\s+([A-Za-z\s\.\'-]+?)\s+to\s+([A-Za-z\s\.\'-]+?)(?:\s+(?:flights?|fly|trains?|rail|bus(?:es)?|tomorrow|today|tonight|on|in|at|for|this|next|morning|evening|afternoon|night|cheapest|direct)|[\.,\?!]|$)",
            clean,
            re.IGNORECASE,
        )
        if m_from_to:
            orig = self._clean_city_token(m_from_to.group(1))
            dest = self._clean_city_token(m_from_to.group(2))
            if orig and dest:
                return orig, dest

        # Pattern 2: "to <DESTINATION> from <ORIGIN>"
        m_to_from = re.search(
            r"\bto\s+([A-Za-z\s\.\'-]+?)\s+from\s+([A-Za-z\s\.\'-]+?)(?:\s+(?:flights?|fly|trains?|rail|bus(?:es)?|tomorrow|today|tonight|on|in|at|for|this|next|morning|evening|afternoon|night)|[\.,\?!]|$)",
            clean,
            re.IGNORECASE,
        )
        if m_to_from:
            dest = self._clean_city_token(m_to_from.group(1))
            orig = self._clean_city_token(m_to_from.group(2))
            if orig and dest:
                return orig, dest

        # Pattern 3: "between <ORIGIN> and <DESTINATION>"
        m_between = re.search(
            r"\bbetween\s+([A-Za-z\s\.\'-]+?)\s+and\s+([A-Za-z\s\.\'-]+?)(?:\s+(?:flights?|fly|trains?|rail|bus(?:es)?|tomorrow|today|tonight|on|in|at|for)|[\.,\?!]|$)",
            clean,
            re.IGNORECASE,
        )
        if m_between:
            orig = self._clean_city_token(m_between.group(1))
            dest = self._clean_city_token(m_between.group(2))
            if orig and dest:
                return orig, dest

        # Pattern 4: "<ORIGIN> to <DESTINATION>"
        stripped = re.sub(
            r"^(?:search|find|show|book|check|get|look up|please|can you find|can you search|i want to find|i want|i need|flights?|trains?|bus(?:es)?)\s+",
            "",
            clean,
            flags=re.IGNORECASE,
        )
        m_city_to_city = re.search(
            r"\b([A-Za-z\s\.\'-]+?)\s+to\s+([A-Za-z\s\.\'-]+?)(?:\s+(?:flights?|fly|trains?|rail|bus(?:es)?|tomorrow|today|tonight|on|in|at|for|this|next|morning|evening|afternoon|night|cheapest|direct)|[\.,\?!]|$)",
            stripped,
            re.IGNORECASE,
        )
        if m_city_to_city:
            orig = self._clean_city_token(m_city_to_city.group(1))
            dest = self._clean_city_token(m_city_to_city.group(2))
            if orig and dest:
                return orig, dest

        return None, None

    def _fallback_intent_classifier(
        self,
        user_message: str,
        prior_context: Optional[CanonicalTravelContext] = None,
    ) -> CanonicalTravelContext:
        """
        Deterministic rule-based intent and canonical context resolver.
        Guarantees:
        1. Explicit travel requests ALWAYS win over prior context (0 context leakage).
        2. Short follow-ups (e.g. 'Tomorrow', 'Two', 'Cheapest') resolve against active context.
        3. Standalone greetings/conversational inputs never trigger travel tools.
        4. Never confuses travel searches with destination-info tourism guides.
        """
        lower = user_message.lower().strip()
        prev_summary = prior_context.to_readable_summary() if prior_context else None

        # Clean punctuation for pattern matching
        clean_text = re.sub(r"[^\w\s]", " ", lower).strip()

        has_travel_cues = bool(re.search(
            r"\b(?:train|trains|flight|flights|fly|plane|hotel|hotels|stay|resort|bus|buses|route|cab|travel|ticket|tickets|booking|delhi|kolkata|mumbai|bangalore|bengaluru|chennai|goa|jaipur|howrah|sealdah|njp|pune|hyderabad)\b",
            lower,
            re.IGNORECASE,
        ))

        # 1. GREETING (Strict standalone greetings only)
        greetings = [
            "hello", "hi", "hey", "good morning", "good evening", "good afternoon",
            "good day", "hello there", "hi there", "hey there", "howdy", "greetings", "namaste"
        ]
        if not has_travel_cues and any(clean_text == g for g in greetings):
            ctx = CanonicalTravelContext(
                intent="greeting",
                request_type="NEW",
                previous_summary=None,
            )
            ctx.updated_summary = "Greeting"
            return ctx

        # 2. CONVERSATIONAL / GENERAL (NON-TRAVEL)
        general_conversational_phrases = [
            "how are you", "how are you doing", "how do you do", "how is it going", "hows it going", "whats up",
            "what can you do", "what are your capabilities", "what can you help with", "who are you",
            "what is your name", "who made you", "who created you", "tell me about yourself",
            "thanks", "thank you", "thanks a lot", "thank you so much", "thx",
            "bye", "goodbye", "see you", "see ya", "talk to you later", "good night",
            "tell me a joke", "joke", "make me laugh", "tell me something funny",
            "what is python", "python", "what is machine learning", "explain machine learning", "machine learning",
            "what is ai", "what is an llm", "tell me about coding", "what is programming",
            "what is the capital of france", "capital of france",
            "what is the weather like", "whats the weather like", "whats the weather", "what is the weather",
            "what time is it", "whats the time", "what day is it",
            "help", "i need help",
            "what is javascript", "what is java", "what is html", "what is css",
            "what is react", "what is nodejs", "what is sql", "what is a database",
            "tell me something", "tell me something interesting", "fun fact",
            "how does ai work", "how does machine learning work", "explain ai",
            "what are you", "are you a robot", "are you human", "are you real",
            "sing a song", "tell me a story", "recite a poem",
            "good job", "well done", "that was helpful", "you are great", "youre great",
            "never mind", "forget it", "cancel",
        ]
        if not has_travel_cues:
            is_exact_general = any(clean_text == p for p in general_conversational_phrases)
            if is_exact_general:
                ctx = CanonicalTravelContext(
                    intent="conversational",
                    request_type="NEW",
                    previous_summary=None,
                )
                ctx.updated_summary = "Conversational"
                return ctx

        # Extract dates and times
        time_val = "evening" if "evening" in lower else ("morning" if "morning" in lower else ("afternoon" if "afternoon" in lower else ("night" if "night" in lower or "tonight" in lower else "any")))
        date_val = "day after tomorrow" if "day after tomorrow" in lower else ("today" if "today" in lower or "tonight" in lower else "tomorrow")

        # 3. EXPLICIT ROUTE TRAVEL REQUEST (HIGHEST TRAVEL PRIORITY - ALWAYS 'NEW')
        # Handles: "Search Kolkata to, Mumbai flights", "Flights from Kolkata to Hyderabad", "Kolkata to Delhi trains tonight"
        exp_orig, exp_dest = self._extract_explicit_route(user_message)
        if exp_orig and exp_dest:
            is_flight = any(w in lower for w in ["flight", "flights", "fly", "plane", "airline", "air"])
            is_train = any(w in lower for w in ["train", "trains", "railway", "irctc", "rail", "shatabdi", "rajdhani", "vande bharat"])
            is_bus = any(w in lower for w in ["bus", "buses", "volvo"])

            if is_train:
                intent_val = "train_search"
            elif is_bus:
                intent_val = "bus_search"
            elif is_flight:
                intent_val = "flight_search"
            else:
                # Default to flight or train if context implies
                intent_val = "flight_search"

            ctx = CanonicalTravelContext(
                intent=intent_val,
                origin=exp_orig,
                destination=exp_dest,
                travel_date=date_val,
                time_constraint=time_val,
                passengers=1,
                request_type="NEW",
                previous_summary=prev_summary,
            )
            ctx.updated_summary = ctx.to_readable_summary()
            return ctx

        # 4. EXPLICIT HOTEL SEARCH (ALWAYS 'NEW' if destination provided)
        if any(w in lower for w in ["hotel", "hotels", "stay", "resort", "room", "accommodation", "places to stay"]):
            dest = self._extract_known_destination(user_message)
            if not dest:
                m_prep = re.search(r"\b(?:in|at|for|near|around|by)\s+([A-Za-z\s]+?)(?:\s+(?:under|below|less than|budget|tomorrow|today|with|for|\d+)|\.|\?|$)", user_message, re.IGNORECASE)
                if m_prep:
                    cand = m_prep.group(1).strip()
                    if cand.lower() not in ["a", "the", "my", "our", "there"]:
                        dest = cand.title()
                if not dest:
                    m_prefix = re.search(r"\b([A-Za-z]+)\s+hotels?\b", user_message, re.IGNORECASE)
                    if m_prefix and m_prefix.group(1).lower() not in ["find", "search", "show", "get", "book", "good", "best", "cheap"]:
                        dest = m_prefix.group(1).title()

            budget = None
            budget_match = re.search(r"\b(?:under|below|less than|budget of|budget)\s*₹?\s*(\d+)", lower)
            if budget_match:
                budget = float(budget_match.group(1))

            sort_val = None
            if any(w in lower for w in ["cheapest", "cheaper", "lowest price", "least expensive"]):
                sort_val = "cheapest"
            elif any(w in lower for w in ["best rated", "highest rated", "rating"]):
                sort_val = "rating"

            loc_pref = None
            if any(w in lower for w in ["city center", "closest to the city center", "closest to city center", "central"]):
                loc_pref = "city center"
            elif any(w in lower for w in ["beach", "beachside"]):
                loc_pref = "beach"

            if dest:
                ctx = CanonicalTravelContext(
                    intent="hotel_search",
                    destination=dest,
                    travel_date="tomorrow",
                    budget=budget,
                    sort_by=sort_val,
                    location_preference=loc_pref,
                    guests=1,
                    request_type="NEW",
                    previous_summary=prev_summary,
                )
                ctx.updated_summary = ctx.to_readable_summary()
                return ctx

        # 5. TRUE SHORT TRAVEL FOLLOW-UP ANSWERS (ONLY WHEN PRIOR TRAVEL CONTEXT EXISTS)
        # (e.g. 'Tomorrow', 'Two', 'Okay. Search flights', 'Which one is cheapest?')
        if prior_context and prior_context.intent in ["flight_search", "train_search", "hotel_search", "bus_search", "route_search", "general_travel"]:
            is_date_answer = bool(re.search(r"\b(?:tomorrow|today|tonight|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this weekend)\b", lower))
            is_filter_answer = bool(re.search(r"\b(?:cheapest|cheaper|lowest price|least expensive|best rated|highest rated|morning|evening|afternoon|night|closest|city center)\b", lower))
            is_passenger_answer = bool(re.search(r"\b(?:two|three|four|\d+)\s*(?:passengers?|seats?|people|persons?)?\b", lower))
            is_standalone_mode_switch = any(w in clean_text.split() for w in ["flight", "flights", "fly", "train", "trains", "hotel", "hotels", "bus", "buses"]) and not exp_orig and not exp_dest

            if is_date_answer or is_filter_answer or is_passenger_answer or is_standalone_mode_switch or self._is_follow_up_phrase(lower):
                updated = prior_context.model_copy()
                updated.request_type = "FOLLOW_UP"
                updated.previous_summary = prev_summary
                updated.needs_clarification = False
                updated.clarification_question = None

                # Handle Standalone Mode Switch
                if "flight" in lower or "fly" in lower:
                    updated.intent = "flight_search"
                elif "train" in lower or "rail" in lower:
                    updated.intent = "train_search"
                elif "hotel" in lower or "stay" in lower or "resort" in lower:
                    updated.intent = "hotel_search"
                elif "bus" in lower:
                    updated.intent = "bus_search"

                # Handle Date
                if "day after tomorrow" in lower:
                    updated.travel_date = "day after tomorrow"
                elif "tomorrow" in lower:
                    updated.travel_date = "tomorrow"
                elif "today" in lower or "tonight" in lower:
                    updated.travel_date = "today"
                    if "tonight" in lower:
                        updated.time_constraint = "night"

                # Handle Time
                if "morning" in lower:
                    updated.time_constraint = "morning"
                elif "evening" in lower:
                    updated.time_constraint = "evening"
                elif "afternoon" in lower:
                    updated.time_constraint = "afternoon"
                elif "night" in lower:
                    updated.time_constraint = "night"

                # Handle Filters
                if any(w in lower for w in ["cheapest", "cheaper", "lowest price", "least expensive", "low price"]):
                    updated.sort_by = "cheapest"
                elif any(w in lower for w in ["best rated", "highest rated", "rating", "best"]):
                    updated.sort_by = "rating"
                if any(w in lower for w in ["city center", "central"]):
                    updated.location_preference = "city center"

                # Handle Passengers
                pass_match = re.search(r"\b(?:for\s+(\d+|two|three|four)|(\d+|two|three|four)\s+(?:people|persons?|passengers?|seats?))\b", lower)
                if pass_match:
                    val_str = pass_match.group(1) or pass_match.group(2)
                    num_map = {"two": 2, "three": 3, "four": 4}
                    updated.passengers = num_map.get(val_str, int(val_str) if val_str and val_str.isdigit() else updated.passengers)

                # Check if user mentioned a new destination without route keywords
                new_dest = self._extract_known_destination(user_message)
                if new_dest and not any(w in lower for w in ["flight", "train", "hotel"]):
                    if not updated.destination or updated.destination.lower() != new_dest.lower():
                        updated.destination = new_dest

                updated.updated_summary = updated.to_readable_summary()
                return updated

        # 6. DESTINATION INFO / TOURISM (Strictly when user asks for sightseeing / attractions without travel search mode)
        has_search_mode = any(w in lower for w in ["flight", "flights", "fly", "train", "trains", "rail", "hotel", "hotels", "bus", "ticket", "tickets"])
        if not has_search_mode and any(w in lower for w in ["best places", "what to see", "attractions", "sightseeing", "places to visit", "what should i visit", "what should i see"]):
            dest = self._extract_known_destination(user_message)
            if not dest:
                if "there" in lower and prior_context and prior_context.destination:
                    dest = prior_context.destination
                else:
                    for prep in ["in", "at", "for", "near", "around"]:
                        if f" {prep} " in lower:
                            candidate = lower.split(f" {prep} ")[-1].strip(" ,.?")
                            if candidate and candidate.lower() not in ["there", "a", "the"]:
                                dest = candidate.title()
            if not dest and prior_context and prior_context.destination:
                dest = prior_context.destination

            ctx = CanonicalTravelContext(
                intent="destination_info",
                destination=dest or "Jaipur",
                request_type="NEW",
                previous_summary=prev_summary,
            )
            ctx.updated_summary = ctx.to_readable_summary()
            return ctx

        # 7. SINGLE CITY + MODE (Clarification / Partial Search)
        # e.g. "Flights to Mumbai", "Train from Kolkata"
        single_city = self._extract_known_destination(user_message)
        if single_city:
            if any(w in lower for w in ["flight", "flights", "fly", "plane"]):
                is_to = bool(re.search(r"\bto\s+", lower))
                dest = single_city if is_to else None
                orig = single_city if not is_to else (prior_context.origin if prior_context else None)
                ctx = CanonicalTravelContext(
                    intent="flight_search",
                    origin=orig,
                    destination=dest,
                    travel_date=date_val,
                    time_constraint=time_val,
                    request_type="NEW",
                    previous_summary=prev_summary,
                )
                if not orig or not dest:
                    ctx.needs_clarification = True
                    ctx.clarification_question = f"Where will you be {'departing from' if not orig else 'flying to'} for your flight?"
                ctx.updated_summary = ctx.to_readable_summary()
                return ctx

            if any(w in lower for w in ["train", "trains", "railway", "irctc", "rail"]):
                is_to = bool(re.search(r"\bto\s+", lower))
                dest = single_city if is_to else None
                orig = single_city if not is_to else (prior_context.origin if prior_context else None)
                ctx = CanonicalTravelContext(
                    intent="train_search",
                    origin=orig,
                    destination=dest,
                    travel_date=date_val,
                    time_constraint=time_val,
                    request_type="NEW",
                    previous_summary=prev_summary,
                )
                if not orig or not dest:
                    ctx.needs_clarification = True
                    ctx.clarification_question = f"Which city will you be {'departing from' if not orig else 'traveling to'}?"
                ctx.updated_summary = ctx.to_readable_summary()
                return ctx

        # 8. DEFAULT: CONVERSATIONAL
        ctx = CanonicalTravelContext(
            intent="conversational",
            request_type="NEW",
            previous_summary=None,
        )
        ctx.updated_summary = "Conversational"
        return ctx

    async def extract_canonical_context(
        self,
        user_message: str,
        prior_context: Optional[CanonicalTravelContext] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> CanonicalTravelContext:
        """
        Extracts structured travel parameters and resolves multi-turn canonical context using Gemini 3.6 Flash.
        Guarantees partial update integrity for follow-ups.
        """
        fallback_ctx = self._fallback_intent_classifier(user_message, prior_context=prior_context)

        if not self.is_configured or not self._client:
            return fallback_ctx

        try:
            prior_ctx_json = (
                json.dumps(prior_context.model_dump())
                if prior_context
                else "None (Initial Request)"
            )

            history_str = ""
            if conversation_history:
                recent = conversation_history[-4:]
                history_str = "\nRecent Conversation History:\n" + "\n".join(
                    [f"{m.get('role')}: {m.get('content')}" for m in recent]
                )

            prompt = (
                f"PREVIOUS_CANONICAL_CONTEXT: {prior_ctx_json}\n"
                f"{history_str}\n\n"
                f"NEW_USER_MESSAGE: \"{user_message}\"\n\n"
                f"Classify request_type as NEW or FOLLOW_UP and output the updated CanonicalTravelContext JSON object."
            )

            config = types.GenerateContentConfig(
                system_instruction=CANONICAL_INTENT_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=CanonicalTravelContext,
                temperature=0.1,
                max_output_tokens=350,
            )

            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=prompt,
                config=config,
            )

            if response and response.text:
                parsed_data = json.loads(response.text)
                extracted_ctx = CanonicalTravelContext.model_validate(parsed_data)

                # Canonicalize station codes if train_search
                if extracted_ctx.intent == "train_search":
                    if extracted_ctx.origin:
                        extracted_ctx.origin = (
                            railway_normalizer.resolve_station_code(extracted_ctx.origin)
                            or extracted_ctx.origin
                        )
                    if extracted_ctx.destination:
                        extracted_ctx.destination = (
                            railway_normalizer.resolve_station_code(extracted_ctx.destination)
                            or extracted_ctx.destination
                        )

                # Follow-up integrity guarantee: preserve prior unchanged fields if Gemini left them empty
                if extracted_ctx.request_type == "FOLLOW_UP" and prior_context:
                    extracted_ctx.previous_summary = prior_context.to_readable_summary()
                    if not extracted_ctx.origin and prior_context.origin:
                        extracted_ctx.origin = prior_context.origin

                    # Strict anti-hallucination guard: if no explicit new city mentioned in user text, keep prior destination
                    user_dest = self._extract_known_destination(user_message)
                    if not user_dest and prior_context.destination:
                        extracted_ctx.destination = prior_context.destination
                    elif not extracted_ctx.destination and prior_context.destination:
                        extracted_ctx.destination = prior_context.destination

                    if not extracted_ctx.travel_date and prior_context.travel_date:
                        extracted_ctx.travel_date = prior_context.travel_date
                    if (not extracted_ctx.time_constraint or extracted_ctx.time_constraint == "any") and prior_context.time_constraint != "any":
                        if not any(w in user_message.lower() for w in ["any time", "anytime", "all day"]):
                            extracted_ctx.time_constraint = prior_context.time_constraint
                    if extracted_ctx.passengers <= 1 and prior_context.passengers > 1:
                        if not any(w in user_message.lower() for w in ["1 passenger", "one person", "1 person", "solo"]):
                            extracted_ctx.passengers = prior_context.passengers
                    if extracted_ctx.budget is None and prior_context.budget is not None:
                        extracted_ctx.budget = prior_context.budget
                    if not extracted_ctx.sort_by and prior_context.sort_by:
                        extracted_ctx.sort_by = prior_context.sort_by
                    if not extracted_ctx.location_preference and prior_context.location_preference:
                        extracted_ctx.location_preference = prior_context.location_preference

                    # If prior was hotel_search and current query is superlative / follow-up, keep hotel_search intent
                    if extracted_ctx.intent == "general_travel" and prior_context.intent == "hotel_search":
                        extracted_ctx.intent = "hotel_search"

                extracted_ctx.updated_summary = extracted_ctx.to_readable_summary()

                # Safety override 1: If deterministic detected an explicit route or hotel search,
                # ensure Gemini does not downgrade it to destination_info, conversational, or greeting
                if fallback_ctx.intent in ["flight_search", "train_search", "hotel_search", "bus_search", "route_search"] and fallback_ctx.request_type == "NEW":
                    if extracted_ctx.intent not in ALLOWED_TOOL_INTENTS or extracted_ctx.intent == "destination_info":
                        logger.info(
                            f"[ROUTE OVERRIDE] Overriding Gemini '{extracted_ctx.intent}' with explicit deterministic travel request: '{fallback_ctx.intent}' ({fallback_ctx.origin} -> {fallback_ctx.destination})"
                        )
                        return fallback_ctx
                    # Ensure explicit new origin/destination from user message are kept
                    if fallback_ctx.origin and (not extracted_ctx.origin or extracted_ctx.origin != fallback_ctx.origin):
                        extracted_ctx.origin = fallback_ctx.origin
                    if fallback_ctx.destination and (not extracted_ctx.destination or extracted_ctx.destination != fallback_ctx.destination):
                        extracted_ctx.destination = fallback_ctx.destination
                    extracted_ctx.intent = fallback_ctx.intent
                    extracted_ctx.request_type = "NEW"

                # Safety override 2: if deterministic says conversational/greeting but Gemini says travel for non-travel short text,
                # prefer conversational for short utterances to prevent false travel routing
                if (
                    fallback_ctx.intent in ["conversational", "greeting"]
                    and extracted_ctx.intent in ALLOWED_TOOL_INTENTS
                    and len(user_message.split()) <= 6
                ):
                    logger.info(
                        f"[SAFETY] Gemini classified '{user_message}' as '{extracted_ctx.intent}' "
                        f"but deterministic says '{fallback_ctx.intent}'. Preferring deterministic for short utterance."
                    )
                    return fallback_ctx

                return extracted_ctx

        except Exception as e:
            logger.warning(f"Gemini canonical context extraction failed, using deterministic fallback: {e}")

        return fallback_ctx

    async def extract_travel_intent(
        self,
        user_message: str,
        prior_intent: Optional[TravelIntent] = None,
        prior_context: Optional[CanonicalTravelContext] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> TravelIntent:
        """
        Unified extraction method returning structured TravelIntent.
        Wraps extract_canonical_context to guarantee compatibility with all test suites and services.
        """
        eff_prior_ctx = prior_context
        if eff_prior_ctx is None and prior_intent is not None:
            eff_prior_ctx = CanonicalTravelContext(
                intent=prior_intent.intent,
                origin=prior_intent.origin,
                destination=prior_intent.destination,
                travel_date=prior_intent.travel_date,
                time_constraint=prior_intent.time_constraint or "any",
                passengers=prior_intent.passengers,
                budget=prior_intent.budget,
                guests=prior_intent.guests,
                sort_by=prior_intent.sort_by,
                location_preference=prior_intent.location_preference,
                preferences=prior_intent.preferences,
                needs_clarification=prior_intent.needs_clarification,
                clarification_question=prior_intent.clarification_question,
            )

        ctx = await self.extract_canonical_context(
            user_message=user_message,
            prior_context=eff_prior_ctx,
            conversation_history=conversation_history,
        )

        return TravelIntent(
            intent=ctx.intent,
            origin=ctx.origin,
            destination=ctx.destination,
            date=ctx.travel_date,
            time_constraint=ctx.time_constraint,
            passengers=ctx.passengers,
            budget=ctx.budget,
            guests=ctx.guests,
            sort_by=ctx.sort_by,
            location_preference=ctx.location_preference,
            preferences=ctx.preferences,
            needs_clarification=ctx.needs_clarification,
            clarification_question=ctx.clarification_question,
            confidence=ctx.confidence,
        )

    async def generate_response(
        self,
        messages: List[Dict[str, Any]],
        tool_results: Optional[Any] = None,
        canonical_context: Optional[CanonicalTravelContext] = None,
        prior_intent: Optional[TravelIntent] = None,
    ) -> LLMResponse:
        """
        Synthesizes a natural, concise spoken voice response for Rime TTS based strictly on tool output or conversation.
        """
        start_time = time.time()

        if canonical_context is None and prior_intent is not None:
            canonical_context = CanonicalTravelContext(
                intent=prior_intent.intent,
                origin=prior_intent.origin,
                destination=prior_intent.destination,
                travel_date=prior_intent.travel_date,
                time_constraint=prior_intent.time_constraint or "any",
                passengers=prior_intent.passengers,
                budget=prior_intent.budget,
                guests=prior_intent.guests,
                sort_by=prior_intent.sort_by,
                location_preference=prior_intent.location_preference,
                preferences=prior_intent.preferences,
            )

        if not self.is_configured or not self._client:
            elapsed_ms = int((time.time() - start_time) * 1000)
            if tool_results:
                spoken = self._format_deterministic_tool_speech(tool_results, canonical_context)
                return LLMResponse(
                    content=spoken,
                    tool_calls=[],
                    canonical_context=canonical_context,
                    latency_ms=max(15, elapsed_ms),
                    model=f"{self.model} (deterministic)",
                    provider="gemini",
                )
            else:
                spoken = self._format_deterministic_conversational_speech(messages, canonical_context)
                return LLMResponse(
                    content=spoken,
                    tool_calls=[],
                    canonical_context=canonical_context,
                    latency_ms=max(15, elapsed_ms),
                    model=f"{self.model} (deterministic)",
                    provider="gemini",
                )

        try:
            contents = []
            for m in messages:
                role = "model" if m.get("role") in ["assistant", "model"] else "user"
                content_text = str(m.get("content") or "")
                if content_text:
                    contents.append(f"{role.upper()}: {content_text}")

            if tool_results:
                contents.append(
                    f"TOOL RESULTS: {json.dumps(tool_results) if isinstance(tool_results, (dict, list)) else str(tool_results)}"
                )
                contents.append(
                    "INSTRUCTION: Synthesize a complete, spoken summary for Rime TTS following the SPOKEN RESULT RULES:\n"
                    "- Mention and summarize EVERY relevant option returned and displayed in the UI (e.g. all 4 flights, all 4 trains, or all 4 hotels).\n"
                    "- For each option, include its key identifying details concisely (name, departure time, and price/fare).\n"
                    "- Do NOT drop options or speak only the first result. Summarize all displayed options compactly in natural conversational speech.\n"
                    "- Ground spoken answers ONLY in information contained in the actual TOOL RESULTS. Never invent prices, times, or details.\n"
                    "- Do NOT say 'demo'. Do NOT read internal JSON, IDs, request IDs, or metadata."
                )

            full_prompt = "\n".join(contents)

            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_VOICE_PROMPT,
                temperature=0.2,
                max_output_tokens=300,
            )

            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=full_prompt,
                config=config,
            )

            elapsed_ms = int((time.time() - start_time) * 1000)
            text_out = response.text.strip() if response and response.text else None

            if not text_out:
                text_out = (
                    self._format_deterministic_tool_speech(tool_results, canonical_context)
                    if tool_results
                    else self._format_deterministic_conversational_speech(messages, canonical_context)
                )

            # Clean any stray markdown
            text_out = text_out.replace("*", "").replace("#", "").replace("`", "").strip()

            return LLMResponse(
                content=text_out,
                tool_calls=[],
                canonical_context=canonical_context,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        except Exception as e:
            logger.error(f"Gemini generate_response error: {e}")
            elapsed_ms = int((time.time() - start_time) * 1000)
            spoken = (
                self._format_deterministic_tool_speech(tool_results, canonical_context)
                if tool_results
                else self._format_deterministic_conversational_speech(messages, canonical_context)
            )
            return LLMResponse(
                content=spoken,
                tool_calls=[],
                canonical_context=canonical_context,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini-fallback",
            )

    def _format_deterministic_tool_speech(
        self, tool_results: Any, canonical_context: Optional[CanonicalTravelContext]
    ) -> str:
        if isinstance(tool_results, str):
            clean_str = tool_results.strip()
            if "returned results:" in clean_str:
                clean_str = clean_str.split("returned results:", 1)[1].strip()
            try:
                tool_results = json.loads(clean_str)
            except Exception:
                try:
                    import ast
                    tool_results = ast.literal_eval(clean_str)
                except Exception:
                    pass

        if not isinstance(tool_results, dict):
            return "Here are the travel options found."

        res_type = tool_results.get("type", "")

        # 1. FLIGHT RESULTS
        if res_type == "flight_search":
            flights = tool_results.get("flights", [])
            orig = tool_results.get("origin", "origin")
            dest = tool_results.get("destination", "destination")
            date_str = tool_results.get("date", "tomorrow")
            time_pref = tool_results.get("time_constraint", "any")
            time_str = f" in the {time_pref}" if time_pref and time_pref != "any" else ""

            if not flights:
                return f"No matching flight options were found from {orig} to {dest} for {date_str}{time_str}."

            count = len(flights)
            if count == 1:
                f0 = flights[0]
                airline = f0.get('airline', 'Flight')
                f_num = f0.get('flight_number', '')
                dep = f0.get('departure', '')
                price = f0.get('price', '')
                return f"I found 1 flight from {orig} to {dest} for {date_str}{time_str}: {airline} {f_num} departing at {dep} for {price}."

            ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
            flight_descs = []
            for idx, f in enumerate(flights):
                ord_word = ordinals[idx] if idx < len(ordinals) else f"option {idx+1}"
                airline = f.get('airline', 'Flight')
                f_num = f.get('flight_number', '')
                dep = f.get('departure', '')
                price = f.get('price', '')
                flight_descs.append(f"the {ord_word} is {airline} {f_num} departing at {dep} for {price}")

            if len(flight_descs) == 2:
                joined = f"{flight_descs[0]}, and {flight_descs[1]}"
            else:
                joined = f"{', '.join(flight_descs[:-1])}, and {flight_descs[-1]}"
            cap_joined = joined[0].upper() + joined[1:] if joined else ""
            return f"I found {count} flight options from {orig} to {dest} for {date_str}{time_str}. {cap_joined}."

        # 2. HOTEL RESULTS
        if res_type == "hotel_search":
            hotels = tool_results.get("hotels", [])
            dest = tool_results.get("destination") or (
                canonical_context.destination if canonical_context else "your destination"
            )
            budget = tool_results.get("budget") or (
                canonical_context.budget if canonical_context else None
            )
            budget_str = f" under ₹{int(budget):,}" if budget else ""

            if not hotels:
                return f"No matching hotel options were found in {dest}{budget_str}."

            count = len(hotels)
            if count == 1:
                h0 = hotels[0]
                name = h0.get('name', 'Hotel')
                rate = h0.get('price_formatted') or (f"₹{h0.get('price')}" if h0.get('price') else "standard rate")
                rating = f" with a {h0.get('rating')} star rating" if h0.get('rating') else ""
                return f"I found 1 hotel option in {dest}{budget_str}: {name} at {rate} per night{rating}."

            ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
            hotel_descs = []
            for idx, h in enumerate(hotels):
                ord_word = ordinals[idx] if idx < len(ordinals) else f"option {idx+1}"
                name = h.get('name', 'Hotel')
                rate = h.get('price_formatted') or (f"₹{h.get('price')}" if h.get('price') else "standard rate")
                hotel_descs.append(f"the {ord_word} is {name} at {rate} per night")

            if len(hotel_descs) == 2:
                joined = f"{hotel_descs[0]}, and {hotel_descs[1]}"
            else:
                joined = f"{', '.join(hotel_descs[:-1])}, and {hotel_descs[-1]}"
            cap_joined = joined[0].upper() + joined[1:] if joined else ""
            return f"I found {count} hotel options in {dest}{budget_str}. {cap_joined}."

        # 3. TRAIN RESULTS
        if res_type == "train_search":
            trains = tool_results.get("trains", [])
            orig = railway_normalizer.resolve_display_name(tool_results.get("origin", ""))
            dest = railway_normalizer.resolve_display_name(tool_results.get("destination", ""))
            date_str = tool_results.get("date", "tomorrow")
            time_pref = tool_results.get("time_constraint", "any")
            time_qualifier = f"{time_pref} " if time_pref and time_pref != "any" else ""

            if not trains:
                return f"No matching {time_qualifier}train options were found between {orig} and {dest} for {date_str}."

            count = len(trains)
            if count == 1:
                t0 = trains[0]
                name = t0.get('name', 'Train')
                fare = t0.get('price') or t0.get('fare') or "standard fare"
                dep = f" departing at {t0.get('departure')}" if t0.get('departure') else ""
                return f"I found 1 {time_qualifier}train option from {orig} to {dest} for {date_str}: {name} at {fare}{dep}."

            ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
            train_descs = []
            for idx, t in enumerate(trains):
                ord_word = ordinals[idx] if idx < len(ordinals) else f"option {idx+1}"
                name = t.get('name', 'Train')
                fare = t.get('price') or t.get('fare') or "standard fare"
                dep = f" departing at {t.get('departure')}" if t.get('departure') else ""
                train_descs.append(f"the {ord_word} is {name}{dep} for {fare}")

            if len(train_descs) == 2:
                joined = f"{train_descs[0]}, and {train_descs[1]}"
            else:
                joined = f"{', '.join(train_descs[:-1])}, and {train_descs[-1]}"
            cap_joined = joined[0].upper() + joined[1:] if joined else ""
            return f"I found {count} {time_qualifier}train options from {orig} to {dest} for {date_str}. {cap_joined}."

        # 4. ROUTE / BUS RESULTS
        if res_type in ["route_search", "bus_search"]:
            routes = tool_results.get("routes", []) or tool_results.get("buses", [])
            orig = tool_results.get("origin", "origin")
            dest = tool_results.get("destination", "destination")
            if not routes:
                return f"I found route options between {orig} and {dest}."

            count = len(routes)
            if count == 1:
                r0 = routes[0]
                mode = r0.get('mode') or r0.get('operator') or 'transit'
                dur = f" taking {r0.get('duration')}" if r0.get('duration') else ""
                price = f" for {r0.get('price')}" if r0.get('price') else ""
                return f"To travel from {orig} to {dest}, you can take {mode}{dur}{price}."

            ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
            route_descs = []
            for idx, r in enumerate(routes):
                ord_word = ordinals[idx] if idx < len(ordinals) else f"option {idx+1}"
                mode = r.get('mode') or r.get('operator') or 'bus'
                dep = f" departing at {r.get('departure')}" if r.get('departure') else ""
                dur = f" taking {r.get('duration')}" if r.get('duration') else ""
                price = f" for {r.get('price')}" if r.get('price') else ""
                route_descs.append(f"the {ord_word} is {mode}{dep}{dur}{price}")

            if len(route_descs) == 2:
                joined = f"{route_descs[0]}, and {route_descs[1]}"
            else:
                joined = f"{', '.join(route_descs[:-1])}, and {route_descs[-1]}"
            cap_joined = joined[0].upper() + joined[1:] if joined else ""
            return f"I found {count} travel options between {orig} and {dest}: {cap_joined}."

        # 5. DESTINATION INFO
        if res_type == "destination_info":
            dest = tool_results.get("destination", "your destination")
            attractions = tool_results.get("top_attractions", [])
            if attractions:
                return f"In {dest}, must-visit attractions include {', '.join(attractions[:3])}."
            return f"Here are the top sights and travel tips for {dest}."

        return "Here are the top options found for your travel request."

    def _format_deterministic_conversational_speech(
        self, messages: List[Dict[str, Any]], canonical_context: Optional[CanonicalTravelContext]
    ) -> str:
        last_msg = str(messages[-1].get("content", "")).lower() if messages else ""
        clean_text = re.sub(r"[^\w\s]", " ", last_msg).strip()

        # 1. Greetings
        if any(clean_text == g or clean_text.startswith(f"{g} ") for g in ["hello", "hi", "hey", "good morning", "good evening", "good afternoon", "hello there", "hi there", "namaste", "howdy"]):
            return "Hello! I'm VoiceTrip. How can I help with your travel plans today?"

        # 2. Capabilities & Identity
        if any(w in clean_text for w in ["what can you do", "what are your capabilities", "what do you do", "how can you help"]):
            return "I can help you search trains, flights, hotels, and bus routes across India, plan custom itineraries, recommend packing lists, and answer your general travel questions. What would you like to explore?"

        if any(w in clean_text for w in ["who are you", "what is your name", "who made you", "who created you", "tell me about yourself"]):
            return "I am VoiceTrip, your AI voice travel assistant. I'm here to make planning and booking trips effortless."

        if any(w in clean_text for w in ["how are you", "how are you doing", "how do you do", "how is it going", "hows it going", "whats up"]):
            return "I'm doing wonderful, thank you! How can I assist you with your day or travel plans?"

        # 3. Politeness & Goodbyes
        if any(w in clean_text for w in ["thank you", "thanks", "thanks a lot", "thank you so much"]):
            return "You're very welcome! Let me know if you need anything else for your journey."

        if any(w in clean_text for w in ["okay", "ok", "great", "awesome", "cool", "perfect", "nice", "got it", "understood"]):
            return "Great! Let me know whenever you're ready to search or plan your next trip."

        if any(w in clean_text for w in ["bye", "goodbye", "see you", "talk to you later", "good night"]):
            return "Goodbye! Have a fantastic day and safe travels on your next adventure!"

        # 4. General Knowledge & Humor
        if any(w in clean_text for w in ["joke", "make me laugh", "tell me something funny"]):
            return "Why don't travel agents get lost? Because they always know how to find their way around!"

        if "python" in clean_text:
            return "Python is a popular, high-level programming language known for its clean syntax, versatility, and extensive use in web development, data science, and artificial intelligence."

        if any(w in clean_text for w in ["machine learning", "what is ml", "explain ml", "what is ai"]):
            return "Machine learning is a field of artificial intelligence where computer systems learn patterns from data to make predictions and decisions without being explicitly programmed."

        if any(w in clean_text for w in ["capital of france", "france capital", "paris"]):
            return "The capital of France is Paris."

        if "weather" in clean_text:
            return "I don't have a live satellite feed for today's weather right now, but tell me which destination you're heading to and I'll share its typical climate and best time to visit."

        # 5. Destination Specifics (if destination info / travel advice)
        if "delhi" in last_msg or (canonical_context and canonical_context.destination == "Delhi"):
            return "In Delhi, top attractions include India Gate, Qutub Minar, Red Fort, and Humayun's Tomb."

        if "mumbai" in last_msg or (canonical_context and canonical_context.destination == "Mumbai"):
            return "In Mumbai, top highlights include the Gateway of India, Marine Drive, Elephanta Caves, and Colaba Causeway."

        if "jaipur" in last_msg or (canonical_context and canonical_context.destination == "Jaipur"):
            return "In Jaipur, top attractions include the magnificent Amber Fort, City Palace, Hawa Mahal, and Jantar Mantar."

        if "goa" in last_msg or (canonical_context and canonical_context.destination == "Goa"):
            if "plan" in last_msg or (canonical_context and canonical_context.intent == "itinerary_planning"):
                return "For a three day Goa trip, explore North Goa beaches on day one, heritage churches in Old Goa on day two, and relax in South Goa on day three."
            return "Goa offers scenic beaches like Palolem and Baga, historic Portuguese forts, and vibrant night markets."

        if "sikkim" in last_msg or (canonical_context and canonical_context.destination == "Sikkim"):
            return "The best time to visit Sikkim is from March to May for blooming flowers, or October to mid-December for clear Himalayan views."

        if "kashmir" in last_msg or (canonical_context and canonical_context.destination == "Kashmir"):
            return "For Kashmir, pack layered warm woolens, a thermal inner set, comfortable walking shoes, and a waterproof windcheater."

        if canonical_context and canonical_context.intent == "destination_info" and canonical_context.destination:
            return f"Top highlights for {canonical_context.destination} include local cultural heritage sites, scenic viewpoints, and authentic regional cuisine."

        return "I am VoiceTrip, your AI travel assistant. How can I help you today?"

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        prior_context: Optional[CanonicalTravelContext] = None,
    ) -> LLMResponse:
        """
        Unified handler: resolves canonical multi-turn travel context and routes to structured tools or voice response.
        """
        start_time = time.time()

        last_user_msg = ""
        history_msgs = []
        for m in messages:
            if m.get("role") == "user":
                last_user_msg = str(m.get("content", ""))
                history_msgs.append(m)
            elif m.get("role") in ["assistant", "model", "tool"]:
                history_msgs.append(m)

        # Check if last message is a tool result
        last_msg = messages[-1] if messages else {}
        if last_msg.get("role") == "tool" or "Tool" in str(last_msg.get("content", "")):
            return await self.generate_response(
                messages=messages,
                tool_results=last_msg.get("content"),
                canonical_context=prior_context,
            )

        # Extract structured canonical context with multi-turn retention
        ctx = await self.extract_canonical_context(
            user_message=last_user_msg,
            prior_context=prior_context,
            conversation_history=history_msgs[:-1] if len(history_msgs) > 1 else None,
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        intent_obj = TravelIntent(
            intent=ctx.intent,
            origin=ctx.origin,
            destination=ctx.destination,
            date=ctx.travel_date,
            time_constraint=ctx.time_constraint,
            passengers=ctx.passengers,
            budget=ctx.budget,
            guests=ctx.guests,
            sort_by=ctx.sort_by,
            location_preference=ctx.location_preference,
            preferences=ctx.preferences,
            needs_clarification=ctx.needs_clarification,
            clarification_question=ctx.clarification_question,
            confidence=ctx.confidence,
        )

        # Handle ambiguity / clarification
        if ctx.needs_clarification and ctx.clarification_question:
            return LLMResponse(
                content=ctx.clarification_question,
                tool_calls=[],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini-clarification",
            )

        if tools is not None and len(tools) == 0:
            res = await self.generate_response(
                messages=messages,
                tool_results=None,
                canonical_context=ctx,
            )
            res.intent = intent_obj
            return res

        # Route to appropriate tool based on canonical context
        if ctx.intent == "flight_search" and ctx.origin and ctx.destination:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="search_flights",
                        arguments={
                            "origin": ctx.origin,
                            "destination": ctx.destination,
                            "date": ctx.travel_date,
                            "time_constraint": ctx.time_constraint,
                            "passengers": ctx.passengers,
                        },
                        id="call_flight_1",
                    )
                ],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        if ctx.intent == "hotel_search" and ctx.destination:
            hotel_args = {
                "destination": ctx.destination,
                "check_in_date": ctx.travel_date,
                "nights": 2,
                "budget": ctx.budget,
                "guests": ctx.guests,
            }
            if ctx.sort_by:
                hotel_args["sort_by"] = ctx.sort_by
            if ctx.location_preference:
                hotel_args["location_preference"] = ctx.location_preference

            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="search_hotels",
                        arguments=hotel_args,
                        id="call_hotel_1",
                    )
                ],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        if ctx.intent == "train_search" and ctx.origin and ctx.destination:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="search_trains",
                        arguments={
                            "origin": ctx.origin,
                            "destination": ctx.destination,
                            "date": ctx.travel_date,
                            "time_constraint": ctx.time_constraint,
                            "passengers": ctx.passengers,
                        },
                        id="call_train_1",
                    )
                ],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        if ctx.intent == "route_search" and ctx.origin and ctx.destination:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="get_route_options",
                        arguments={
                            "origin": ctx.origin,
                            "destination": ctx.destination,
                        },
                        id="call_route_1",
                    )
                ],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        if ctx.intent == "destination_info" and ctx.destination:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        name="get_destination_info",
                        arguments={
                            "destination": ctx.destination,
                            "category": "all",
                        },
                        id="call_dest_1",
                    )
                ],
                canonical_context=ctx,
                intent=intent_obj,
                latency_ms=elapsed_ms,
                model=self.model,
                provider="gemini",
            )

        # Conversational generation for itinerary, packing, timing, advice
        resp = await self.generate_response(
            messages=messages,
            tool_results=None,
            canonical_context=ctx,
        )
        resp.intent = intent_obj
        return resp
