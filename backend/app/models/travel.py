from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

IntentType = Literal[
    "greeting",
    "conversational",
    "unclear",
    "train_search",
    "flight_search",
    "hotel_search",
    "bus_search",
    "route_search",
    "destination_info",
    "itinerary_planning",
    "travel_advice",
    "general_travel",
    "unknown",
]


class TravelIntent(BaseModel):
    """
    Controlled structured routing object extracted from user speech.
    Supports general travel requests without assuming railway domain.
    """
    intent: IntentType = Field(
        default="conversational",
        description="Controlled intent classification: 'greeting', 'conversational', 'unclear', 'train_search', 'flight_search', 'hotel_search', 'bus_search', 'route_search', 'destination_info', 'itinerary_planning', 'travel_advice', 'general_travel', 'unknown'",
    )
    confidence: float = Field(
        default=0.95,
        description="Classification confidence score between 0.0 and 1.0",
    )
    origin: Optional[str] = Field(
        default=None,
        description="Departure city/station/airport (e.g. 'Kolkata', 'NJP', 'Delhi', 'Mumbai')",
    )
    destination: Optional[str] = Field(
        default=None,
        description="Target destination city/station/airport/region (e.g. 'Goa', 'Jaipur', 'Delhi', 'Howrah', 'Darjeeling', 'Sikkim', 'Kashmir')",
    )
    date: Optional[str] = Field(
        default="tomorrow",
        description="Travel or check-in date expression (e.g. 'today', 'tomorrow', 'Friday', '2026-09-06')",
    )
    return_date: Optional[str] = Field(
        default=None,
        description="Optional return date expression",
    )
    time_constraint: Optional[str] = Field(
        default="any",
        description="Time constraint: 'morning', 'afternoon', 'evening', 'night', or 'any'",
    )
    passengers: int = Field(
        default=1,
        description="Number of passengers or travelers",
    )
    budget: Optional[float] = Field(
        default=None,
        description="Maximum budget amount in INR (e.g. 5000 for 'under 5000 rupees')",
    )
    guests: Optional[int] = Field(
        default=1,
        description="Number of guests for hotel booking",
    )
    sort_by: Optional[str] = Field(
        default=None,
        description="Sorting preference (e.g. 'cheapest', 'rating', 'distance')",
    )
    location_preference: Optional[str] = Field(
        default=None,
        description="Location preference within city (e.g. 'city center', 'near station', 'beach')",
    )
    preferences: List[str] = Field(
        default_factory=list,
        description="List of user preferences (e.g. ['non-stop', 'pool', 'budget'])",
    )
    needs_clarification: bool = Field(
        default=False,
        description="True if key travel details or ambiguous intent require clarifying with user",
    )
    clarification_question: Optional[str] = Field(
        default=None,
        description="Concise 1-sentence clarifying question to ask the user",
    )

    # Backward compatibility alias
    @property
    def travel_date(self) -> str:
        return self.date or "tomorrow"


class CanonicalTravelContext(BaseModel):
    """
    Single source of truth for the active multi-turn travel context in a session.
    Preserved across user turns, follow-ups, and audio interruptions.
    """
    intent: IntentType = Field(
        default="general_travel",
        description="Active classified travel intent",
    )
    confidence: float = Field(
        default=0.95,
        description="Intent extraction confidence score",
    )
    origin: Optional[str] = Field(
        default=None,
        description="Departure station / city / airport",
    )
    destination: Optional[str] = Field(
        default=None,
        description="Destination station / city / airport / region",
    )
    travel_date: str = Field(
        default="tomorrow",
        description="Travel or check-in date",
    )
    time_constraint: str = Field(
        default="any",
        description="Time constraint: 'morning', 'afternoon', 'evening', 'night', 'any'",
    )
    passengers: int = Field(
        default=1,
        description="Number of passengers",
    )
    budget: Optional[float] = Field(
        default=None,
        description="Max budget in INR",
    )
    guests: int = Field(
        default=1,
        description="Number of hotel guests",
    )
    sort_by: Optional[str] = Field(
        default=None,
        description="Active sorting preference e.g. 'cheapest', 'rating'",
    )
    location_preference: Optional[str] = Field(
        default=None,
        description="Active location preference within city e.g. 'city center'",
    )
    preferences: List[str] = Field(
        default_factory=list,
        description="Active preferences",
    )
    request_type: Literal["NEW", "FOLLOW_UP"] = Field(
        default="NEW",
        description="Classification: 'NEW' for fresh requests, 'FOLLOW_UP' for modifications",
    )
    previous_summary: Optional[str] = Field(
        default=None,
        description="Readable summary of the previous context before this turn",
    )
    updated_summary: Optional[str] = Field(
        default=None,
        description="Readable summary of the updated canonical context",
    )
    needs_clarification: bool = Field(
        default=False,
        description="True if key travel details or ambiguous intent require clarifying with user",
    )
    clarification_question: Optional[str] = Field(
        default=None,
        description="Concise 1-sentence clarifying question to ask the user",
    )

    def to_readable_summary(self) -> str:
        """Returns a clear concise user-facing summary of what was understood."""
        if self.intent == "greeting":
            return "👋 Greeting"
        elif self.intent == "conversational":
            return "💬 General Conversation"
        elif self.intent == "unclear":
            return "❓ Clarification"

        parts = []
        if self.intent == "train_search":
            orig = self.origin or "Origin"
            dest = self.destination or "Destination"
            parts.append(f"🚆 Train: {orig} → {dest}")
        elif self.intent == "flight_search":
            orig = self.origin or "Origin"
            dest = self.destination or "Destination"
            parts.append(f"✈️ Flight: {orig} → {dest}")
        elif self.intent == "hotel_search":
            dest = self.destination or "Destination"
            parts.append(f"🏨 Hotels in {dest}")
            if self.budget:
                parts.append(f"Budget: Under ₹{int(self.budget):,}")
        elif self.intent == "route_search":
            parts.append(f"🗺️ Route: {self.origin or 'Origin'} → {self.destination or 'Destination'}")
        elif self.intent == "destination_info":
            parts.append(f"✨ Highlights in {self.destination or 'Destination'}")
        elif self.intent == "itinerary_planning":
            parts.append(f"📅 Itinerary for {self.destination or 'Destination'}")
        elif self.intent == "travel_advice":
            parts.append(f"🎒 Travel Advice for {self.destination or 'Destination'}")
        else:
            parts.append(f"🧭 {self.intent.replace('_', ' ').title()}")

        if self.travel_date and self.intent in ["train_search", "flight_search", "hotel_search"]:
            parts.append(f"Date: {self.travel_date.title()}")
        if self.time_constraint and self.time_constraint != "any":
            parts.append(f"Time: {self.time_constraint.title()}")
        if self.passengers > 1:
            parts.append(f"{self.passengers} Passengers")
        if self.guests > 1 and self.intent == "hotel_search":
            parts.append(f"{self.guests} Guests")
        return " | ".join(parts)



# ==============================================================================
# Train Models
# ==============================================================================
class TrainItem(BaseModel):
    train_number: str
    name: str
    departure: str
    arrival: str
    duration: str
    departure_time_type: str  # "morning", "afternoon", "evening", "night"
    classes: List[str]
    price: str
    origin_code: Optional[str] = None
    destination_code: Optional[str] = None


class SearchTrainsRequest(BaseModel):
    origin: str
    destination: str
    date: Optional[str] = "tomorrow"
    time_constraint: Optional[str] = "any"
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"
    passengers: Optional[int] = 1


class SearchTrainsResult(BaseModel):
    source: str = "demo"
    type: str = "train_search"
    request_id: str
    generation_id: str
    origin: str
    destination: str
    date: str
    time_constraint: Optional[str]
    trains: List[TrainItem]
    is_cancelled: bool = False
    is_stale: bool = False
    execution_time_ms: int
    intent: Optional[TravelIntent] = None


# ==============================================================================
# Flight Models
# ==============================================================================
class FlightItem(BaseModel):
    flight_number: str
    airline: str
    departure: str
    arrival: str
    duration: str
    departure_time_type: str  # "morning", "afternoon", "evening", "night"
    stops: str  # "Non-stop" or "1 Stop"
    cabin_class: str
    price: str
    origin_city: str
    destination_city: str


class SearchFlightsRequest(BaseModel):
    origin: str
    destination: str
    date: Optional[str] = "tomorrow"
    time_constraint: Optional[str] = "any"
    passengers: Optional[int] = 1
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"


class SearchFlightsResult(BaseModel):
    source: str = "demo"
    type: str = "flight_search"
    request_id: str
    generation_id: str
    origin: str
    destination: str
    date: str
    time_constraint: Optional[str]
    passengers: int
    flights: List[FlightItem]
    is_cancelled: bool = False
    is_stale: bool = False
    execution_time_ms: int
    intent: Optional[TravelIntent] = None


# ==============================================================================
# Hotel Models
# ==============================================================================
class HotelItem(BaseModel):
    hotel_id: str
    name: str
    location: str
    destination: str
    rating: float
    price_per_night: float
    price_formatted: str
    amenities: List[str]
    room_type: str


class SearchHotelsRequest(BaseModel):
    destination: str
    check_in_date: Optional[str] = "tomorrow"
    nights: Optional[int] = 2
    budget: Optional[float] = None
    guests: Optional[int] = 1
    sort_by: Optional[str] = None
    location_preference: Optional[str] = None
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"


class SearchHotelsResult(BaseModel):
    source: str = "demo"
    type: str = "hotel_search"
    request_id: str
    generation_id: str
    destination: str
    query_location: Optional[str] = None
    check_in_date: str
    nights: int
    budget: Optional[float]
    guests: int
    hotels: List[HotelItem]
    is_cancelled: bool = False
    is_stale: bool = False
    execution_time_ms: int
    intent: Optional[TravelIntent] = None


# ==============================================================================
# Route Models
# ==============================================================================
class RouteItem(BaseModel):
    mode: str  # "Flight + Taxi", "Direct Train", "Bus", "Scenic Drive"
    title: str
    duration: str
    estimated_cost: str
    description: str
    transfers: int


class RouteOptionsRequest(BaseModel):
    origin: str
    destination: str
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"


class RouteOptionsResult(BaseModel):
    source: str = "demo"
    type: str = "route_search"
    request_id: str
    generation_id: str
    origin: str
    destination: str
    routes: List[RouteItem]
    is_cancelled: bool = False
    is_stale: bool = False
    execution_time_ms: int
    intent: Optional[TravelIntent] = None


# ==============================================================================
# Destination Info Models
# ==============================================================================
class DestinationInfoRequest(BaseModel):
    destination: str
    category: Optional[str] = "all"  # "attractions", "best_time", "cuisine", "all"
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"


class DestinationInfoResult(BaseModel):
    source: str = "demo"
    type: str = "destination_info"
    request_id: str
    generation_id: str
    destination: str
    best_time_to_visit: str
    top_attractions: List[str]
    local_tips: List[str]
    overview: str
    is_cancelled: bool = False
    is_stale: bool = False
    execution_time_ms: int
    intent: Optional[TravelIntent] = None
