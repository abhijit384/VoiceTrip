import uuid
import time
import asyncio
import logging
from typing import List, Optional, Dict, Any
from app.core.config import settings
from app.models.travel import (
    TrainItem,
    SearchTrainsResult,
    FlightItem,
    SearchFlightsResult,
    HotelItem,
    SearchHotelsResult,
    RouteItem,
    RouteOptionsResult,
    DestinationInfoResult,
    TravelIntent,
)
from app.services.railway_normalizer import railway_normalizer

logger = logging.getLogger("tool-service")

# ==============================================================================
# Deterministic Train Catalog
# ==============================================================================
DEMO_TRAINS: List[TrainItem] = [
    # NJP <-> HWH / SDAH
    TrainItem(
        train_number="22302",
        name="NJP - Howrah Vande Bharat Express",
        departure="15:00 (NJP)",
        arrival="22:35 (HWH)",
        duration="07h 35m",
        departure_time_type="evening",
        classes=["EC", "CC"],
        price="₹1,565",
        origin_code="NJP",
        destination_code="HWH",
    ),
    TrainItem(
        train_number="12042",
        name="New Jalpaiguri - Howrah Shatabdi Express",
        departure="05:30 (NJP)",
        arrival="13:35 (HWH)",
        duration="08h 05m",
        departure_time_type="morning",
        classes=["EC", "CC"],
        price="₹1,390",
        origin_code="NJP",
        destination_code="HWH",
    ),
    TrainItem(
        train_number="12378",
        name="Padatik Express (NJP to SDAH)",
        departure="17:45 (NJP)",
        arrival="06:45 (+1) (SDAH)",
        duration="11h 00m",
        departure_time_type="evening",
        classes=["1A", "2A", "3A", "SL"],
        price="₹1,380",
        origin_code="NJP",
        destination_code="SDAH",
    ),
    TrainItem(
        train_number="12344",
        name="Darjeeling Mail (NJP to SDAH)",
        departure="20:00 (NJP)",
        arrival="06:00 (+1) (SDAH)",
        duration="10h 00m",
        departure_time_type="night",
        classes=["1A", "2A", "3A", "SL"],
        price="₹1,420",
        origin_code="NJP",
        destination_code="SDAH",
    ),
    TrainItem(
        train_number="22301",
        name="Howrah - NJP Vande Bharat Express",
        departure="05:55 (HWH)",
        arrival="13:25 (NJP)",
        duration="07h 30m",
        departure_time_type="morning",
        classes=["EC", "CC"],
        price="₹1,565",
        origin_code="HWH",
        destination_code="NJP",
    ),
    # HWH <-> NDLS
    TrainItem(
        train_number="12301",
        name="Howrah - New Delhi Rajdhani Express",
        departure="16:55 (HWH)",
        arrival="10:05 (+1) (NDLS)",
        duration="17h 10m",
        departure_time_type="evening",
        classes=["1A", "2A", "3A"],
        price="₹3,890",
        origin_code="HWH",
        destination_code="NDLS",
    ),
    TrainItem(
        train_number="12303",
        name="Poorva Express (via Patna)",
        departure="08:00 (HWH)",
        arrival="06:00 (+1) (NDLS)",
        duration="22h 00m",
        departure_time_type="morning",
        classes=["1A", "2A", "3A", "SL"],
        price="₹2,450",
        origin_code="HWH",
        destination_code="NDLS",
    ),
    # Mumbai <-> Pune
    TrainItem(
        train_number="12127",
        name="Mumbai CSMT - Pune Intercity Superfast Express",
        departure="06:40 (CSMT)",
        arrival="09:57 (PUNE)",
        duration="03h 17m",
        departure_time_type="morning",
        classes=["CC", "2S"],
        price="₹390",
        origin_code="CSMT",
        destination_code="PUNE",
    ),
    TrainItem(
        train_number="12125",
        name="Pragati Superfast Express",
        departure="16:25 (CSMT)",
        arrival="19:50 (PUNE)",
        duration="03h 25m",
        departure_time_type="evening",
        classes=["CC", "2S"],
        price="₹390",
        origin_code="CSMT",
        destination_code="PUNE",
    ),
    # Sealdah / Howrah <-> Kharagpur
    TrainItem(
        train_number="12814",
        name="Steel Express",
        departure="17:25 (SDAH)",
        arrival="19:20 (KGP)",
        duration="01h 55m",
        departure_time_type="evening",
        classes=["CC", "2S"],
        price="₹280",
        origin_code="SDAH",
        destination_code="KGP",
    ),
    TrainItem(
        train_number="12871",
        name="Ispat Express",
        departure="06:55 (SDAH)",
        arrival="08:50 (KGP)",
        duration="01h 55m",
        departure_time_type="morning",
        classes=["CC", "2S"],
        price="₹280",
        origin_code="SDAH",
        destination_code="KGP",
    ),
]

# ==============================================================================
# Deterministic Flight Catalog (Clearly Tagged Demo Data)
# ==============================================================================
DEMO_FLIGHTS: List[FlightItem] = [
    # Kolkata <-> Delhi
    FlightItem(
        flight_number="6E-204",
        airline="IndiGo",
        departure="07:10 (CCU)",
        arrival="09:35 (DEL)",
        duration="02h 25m",
        departure_time_type="morning",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹5,420",
        origin_city="Kolkata",
        destination_city="Delhi",
    ),
    FlightItem(
        flight_number="AI-401",
        airline="Air India",
        departure="14:30 (CCU)",
        arrival="17:00 (DEL)",
        duration="02h 30m",
        departure_time_type="afternoon",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹6,150",
        origin_city="Kolkata",
        destination_city="Delhi",
    ),
    FlightItem(
        flight_number="UK-720",
        airline="Vistara",
        departure="18:45 (CCU)",
        arrival="21:15 (DEL)",
        duration="02h 30m",
        departure_time_type="evening",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹6,890",
        origin_city="Kolkata",
        destination_city="Delhi",
    ),
    FlightItem(
        flight_number="SG-8169",
        airline="SpiceJet",
        departure="21:30 (CCU)",
        arrival="23:55 (DEL)",
        duration="02h 25m",
        departure_time_type="night",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹4,950",
        origin_city="Kolkata",
        destination_city="Delhi",
    ),
    # Delhi <-> Bangalore
    FlightItem(
        flight_number="6E-5012",
        airline="IndiGo",
        departure="06:15 (DEL)",
        arrival="09:05 (BLR)",
        duration="02h 50m",
        departure_time_type="morning",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹6,200",
        origin_city="Delhi",
        destination_city="Bangalore",
    ),
    FlightItem(
        flight_number="AI-803",
        airline="Air India",
        departure="17:30 (DEL)",
        arrival="20:20 (BLR)",
        duration="02h 50m",
        departure_time_type="evening",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹7,100",
        origin_city="Delhi",
        destination_city="Bangalore",
    ),
    # Mumbai <-> Goa
    FlightItem(
        flight_number="6E-342",
        airline="IndiGo",
        departure="08:30 (BOM)",
        arrival="09:45 (GOI)",
        duration="01h 15m",
        departure_time_type="morning",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹3,800",
        origin_city="Mumbai",
        destination_city="Goa",
    ),
    FlightItem(
        flight_number="QP-1382",
        airline="Akasa Air",
        departure="16:15 (BOM)",
        arrival="17:30 (GOI)",
        duration="01h 15m",
        departure_time_type="evening",
        stops="Non-stop",
        cabin_class="Economy",
        price="₹3,450",
        origin_city="Mumbai",
        destination_city="Goa",
    ),
]

# ==============================================================================
# Deterministic Hotel Catalog (Clearly Tagged Demo Data)
# ==============================================================================
DEMO_HOTELS: List[HotelItem] = [
    # Delhi
    HotelItem(
        hotel_id="del_1",
        name="The Imperial New Delhi",
        location="Janpath, Connaught Place, Central Delhi",
        destination="Delhi",
        rating=4.9,
        price_per_night=12500.0,
        price_formatted="₹12,500",
        amenities=["City Center", "Heritage Luxury", "Outdoor Pool", "Fine Dining Spa"],
        room_type="Heritage Grand Room",
    ),
    HotelItem(
        hotel_id="del_2",
        name="The Claridges New Delhi",
        location="APJ Abdul Kalam Road, Central Delhi",
        destination="Delhi",
        rating=4.7,
        price_per_night=8200.0,
        price_formatted="₹8,200",
        amenities=["Central Location", "Swimming Pool", "Sevilla Restaurant", "Free Wi-Fi"],
        room_type="Deluxe Courtyard Room",
    ),
    HotelItem(
        hotel_id="del_3",
        name="Bloomrooms @ New Delhi Station",
        location="Paharganj / Near Railway Station, Central Delhi",
        destination="Delhi",
        rating=4.3,
        price_per_night=2800.0,
        price_formatted="₹2,800",
        amenities=["Near Station & Metro", "Free High-Speed Wi-Fi", "Cafe", "AC"],
        room_type="Standard King Room",
    ),
    HotelItem(
        hotel_id="del_4",
        name="Zostel Delhi Central",
        location="Near New Delhi Metro, Central Delhi",
        destination="Delhi",
        rating=4.5,
        price_per_night=950.0,
        price_formatted="₹950",
        amenities=["Budget Stay", "Rooftop Cafe", "Common Lounge", "City Walking Tours"],
        room_type="Private En-suite Dorm / Room",
    ),
    # Mumbai
    HotelItem(
        hotel_id="bom_1",
        name="The Taj Mahal Palace",
        location="Apollo Bunder, Colaba, South Mumbai",
        destination="Mumbai",
        rating=4.9,
        price_per_night=18000.0,
        price_formatted="₹18,000",
        amenities=["Sea View", "Historic Icon", "Luxury Spa", "Swimming Pool"],
        room_type="Luxury Palace Room",
    ),
    HotelItem(
        hotel_id="bom_2",
        name="Trident Nariman Point",
        location="Marine Drive, Nariman Point, South Mumbai",
        destination="Mumbai",
        rating=4.7,
        price_per_night=9500.0,
        price_formatted="₹9,500",
        amenities=["Marine Drive View", "Fitness Center", "Outdoor Pool", "Bar"],
        room_type="Superior City View Room",
    ),
    HotelItem(
        hotel_id="bom_3",
        name="Hotel Suba Palace",
        location="Colaba, South Mumbai",
        destination="Mumbai",
        rating=4.4,
        price_per_night=4200.0,
        price_formatted="₹4,200",
        amenities=["Near Gateway of India", "Free Breakfast", "Free Wi-Fi"],
        room_type="Deluxe Executive Room",
    ),
    HotelItem(
        hotel_id="bom_4",
        name="Zostel Mumbai",
        location="Andheri East, Mumbai",
        destination="Mumbai",
        rating=4.4,
        price_per_night=1100.0,
        price_formatted="₹1,100",
        amenities=["Budget Stay", "Metro Access", "Co-working Space", "Cafe"],
        room_type="Standard AC Room",
    ),
    # Goa
    HotelItem(
        hotel_id="goa_1",
        name="Heritage Village Resort & Spa",
        location="Arossim Beach, South Goa",
        destination="Goa",
        rating=4.6,
        price_per_night=4800.0,
        price_formatted="₹4,800",
        amenities=["Swimming Pool", "Beach Access", "Free Breakfast", "Spa"],
        room_type="Deluxe Pool View Room",
    ),
    HotelItem(
        hotel_id="goa_2",
        name="Baga Beachside Boutique Stay",
        location="Baga Beach, North Goa",
        destination="Goa",
        rating=4.2,
        price_per_night=3200.0,
        price_formatted="₹3,200",
        amenities=["Near Beach", "Free Wi-Fi", "Air Conditioning", "Bar"],
        room_type="Standard AC Room",
    ),
    HotelItem(
        hotel_id="goa_3",
        name="Taj Exotica Resort & Spa",
        location="Benaulim, South Goa",
        destination="Goa",
        rating=4.9,
        price_per_night=14500.0,
        price_formatted="₹14,500",
        amenities=["Private Beach", "Golf Course", "Fine Dining", "Luxury Spa"],
        room_type="Luxury Villa",
    ),
    HotelItem(
        hotel_id="goa_4",
        name="Zostel Goa Morjim",
        location="Morjim Beach, North Goa",
        destination="Goa",
        rating=4.4,
        price_per_night=1050.0,
        price_formatted="₹1,050",
        amenities=["Budget Beach Stay", "Swimming Pool", "Cafe", "Wi-Fi"],
        room_type="Private En-suite Beach Room",
    ),
    # Jaipur
    HotelItem(
        hotel_id="jpr_1",
        name="Umaid Bhawan Heritage House",
        location="Bani Park, Jaipur",
        destination="Jaipur",
        rating=4.7,
        price_per_night=4200.0,
        price_formatted="₹4,200",
        amenities=["Rooftop Restaurant", "Swimming Pool", "Heritage Decor"],
        room_type="Royal Heritage Room",
    ),
    HotelItem(
        hotel_id="jpr_2",
        name="Zostel Jaipur Heritage Hostel",
        location="City Center, Jaipur",
        destination="Jaipur",
        rating=4.5,
        price_per_night=1200.0,
        price_formatted="₹1,200",
        amenities=["Common Lounge", "Free Wi-Fi", "Cafe", "City Tours"],
        room_type="Private En-suite Room",
    ),
    HotelItem(
        hotel_id="jpr_3",
        name="Rambagh Palace",
        location="Bhawani Singh Road, Jaipur",
        destination="Jaipur",
        rating=5.0,
        price_per_night=24000.0,
        price_formatted="₹24,000",
        amenities=["Royal Palace Grounds", "Luxury Spa", "Fine Dining", "Butler Service"],
        room_type="Palace King Suite",
    ),
    # Darjeeling
    HotelItem(
        hotel_id="darj_1",
        name="Mayfair Darjeeling Himalayan Resort",
        location="The Mall, Darjeeling",
        destination="Darjeeling",
        rating=4.8,
        price_per_night=7500.0,
        price_formatted="₹7,500",
        amenities=["Kanchenjunga View", "Heated Rooms", "Spa", "Tea Lounge"],
        room_type="Executive Himalayan View",
    ),
    HotelItem(
        hotel_id="darj_2",
        name="Cedar Inn Boutique Lodge",
        location="Jalapahar, Darjeeling",
        destination="Darjeeling",
        rating=4.4,
        price_per_night=4100.0,
        price_formatted="₹4,100",
        amenities=["Mountain View", "Fireplace", "Breakfast Included"],
        room_type="Deluxe Valley View",
    ),
    # Kolkata
    HotelItem(
        hotel_id="ccu_1",
        name="The Oberoi Grand",
        location="Jawaharlal Nehru Road, Esplanade, Central Kolkata",
        destination="Kolkata",
        rating=4.8,
        price_per_night=9800.0,
        price_formatted="₹9,800",
        amenities=["City Center", "Swimming Pool", "Spa", "Heritage Grandeur"],
        room_type="Premier Room",
    ),
    HotelItem(
        hotel_id="ccu_2",
        name="The Peerless Inn",
        location="Chowringhee, Central Kolkata",
        destination="Kolkata",
        rating=4.3,
        price_per_night=3900.0,
        price_formatted="₹3,900",
        amenities=["Near Metro", "Free Breakfast", "Restaurant", "Wi-Fi"],
        room_type="Superior Room",
    ),
    # Bangalore
    HotelItem(
        hotel_id="blr_1",
        name="The Leela Palace Bengaluru",
        location="Old Airport Road, Bangalore",
        destination="Bangalore",
        rating=4.9,
        price_per_night=13500.0,
        price_formatted="₹13,500",
        amenities=["Grand Architecture", "Spa", "Fine Dining", "Swimming Pool"],
        room_type="Royal Premiere Room",
    ),
    HotelItem(
        hotel_id="blr_2",
        name="Bloomrooms @ Indiranagar",
        location="Indiranagar, Bangalore",
        destination="Bangalore",
        rating=4.4,
        price_per_night=3100.0,
        price_formatted="₹3,100",
        amenities=["Prime Cafe Hub", "Free High-Speed Wi-Fi", "AC", "Breakfast"],
        room_type="Value Queen Room",
    ),
]


class ToolService:
    @staticmethod
    async def search_trains(
        origin: str,
        destination: str,
        date: str = "tomorrow",
        time_constraint: Optional[str] = "any",
        passengers: int = 1,
        generation_id: str = "gen_1",
        delay_seconds: Optional[float] = None,
        **kwargs,
    ) -> SearchTrainsResult:
        request_id = f"req_{uuid.uuid4().hex[:8]}_trains"
        start_time = time.time()
        logger.info(
            f"[{request_id}] search_trains: {origin} -> {destination}, date={date}, time={time_constraint}, gen={generation_id}"
        )

        try:
            delay = delay_seconds if delay_seconds is not None else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
            if delay > 0:
                await asyncio.sleep(delay)

            orig_code = railway_normalizer.resolve_station_code(origin) or origin.upper()
            dest_code = railway_normalizer.resolve_station_code(destination) or destination.upper()
            norm_time = (time_constraint or "any").lower()

            matched = []
            for t in DEMO_TRAINS:
                orig_match = (
                    (t.origin_code == orig_code)
                    or (orig_code in ["HWH", "SDAH", "KOAA"] and t.origin_code in ["HWH", "SDAH", "KOAA"])
                    or (orig_code in ["NDLS", "DLI"] and t.origin_code in ["NDLS", "DLI"])
                )
                dest_match = (
                    (t.destination_code == dest_code)
                    or (dest_code in ["HWH", "SDAH", "KOAA"] and t.destination_code in ["HWH", "SDAH", "KOAA"])
                    or (dest_code in ["NDLS", "DLI"] and t.destination_code in ["NDLS", "DLI"])
                )
                if orig_match and dest_match:
                    if norm_time == "any" or t.departure_time_type == norm_time:
                        matched.append(t)

            # Strict: No hidden fallback to different routes or random demo trains!
            elapsed_ms = int((time.time() - start_time) * 1000)
            return SearchTrainsResult(
                source="demo",
                type="train_search",
                request_id=request_id,
                generation_id=generation_id,
                origin=origin,
                destination=destination,
                date=date,
                time_constraint=norm_time,
                trains=matched,
                is_cancelled=False,
                is_stale=False,
                execution_time_ms=elapsed_ms,
                intent=TravelIntent(
                    intent="train_search",
                    origin=origin,
                    destination=destination,
                    date=date,
                    time_constraint=norm_time,
                    passengers=passengers,
                ),
            )

        except asyncio.CancelledError:
            logger.warning(f"[{request_id}] search_trains CANCELLED (gen={generation_id})")
            raise

    @staticmethod
    async def search_flights(
        origin: str,
        destination: str,
        date: str = "tomorrow",
        time_constraint: Optional[str] = "any",
        passengers: int = 1,
        generation_id: str = "gen_1",
        delay_seconds: Optional[float] = None,
    ) -> SearchFlightsResult:
        request_id = f"req_{uuid.uuid4().hex[:8]}_flights"
        start_time = time.time()
        logger.info(
            f"[{request_id}] search_flights: {origin} -> {destination}, date={date}, time={time_constraint}, gen={generation_id}"
        )

        try:
            delay = delay_seconds if delay_seconds is not None else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
            if delay > 0:
                await asyncio.sleep(delay)

            orig_lower = origin.lower().strip()
            dest_lower = destination.lower().strip()
            time_pref = (time_constraint or "any").lower()

            matched = []
            for f in DEMO_FLIGHTS:
                orig_match = orig_lower in f.origin_city.lower() or f.origin_city.lower() in orig_lower
                dest_match = dest_lower in f.destination_city.lower() or f.destination_city.lower() in dest_lower
                if orig_match and dest_match:
                    if time_pref == "any" or f.departure_time_type == time_pref:
                        matched.append(f)

            # If no direct entry in static list, synthesize flights strictly connecting requested cities
            if not matched and origin and destination:
                synth_flights = [
                    FlightItem(
                        flight_number="6E-101",
                        airline="IndiGo",
                        departure=f"08:15 ({origin[:3].upper()})",
                        arrival=f"10:45 ({destination[:3].upper()})",
                        duration="02h 30m",
                        departure_time_type="morning",
                        stops="Non-stop",
                        cabin_class="Economy",
                        price="₹5,800",
                        origin_city=origin.title(),
                        destination_city=destination.title(),
                    ),
                    FlightItem(
                        flight_number="AI-502",
                        airline="Air India",
                        departure=f"18:20 ({origin[:3].upper()})",
                        arrival=f"20:50 ({destination[:3].upper()})",
                        duration="02h 30m",
                        departure_time_type="evening",
                        stops="Non-stop",
                        cabin_class="Economy",
                        price="₹6,400",
                        origin_city=origin.title(),
                        destination_city=destination.title(),
                    ),
                ]
                if time_pref == "any":
                    matched = synth_flights
                else:
                    matched = [f for f in synth_flights if f.departure_time_type == time_pref]

            elapsed_ms = int((time.time() - start_time) * 1000)
            return SearchFlightsResult(
                source="demo",
                type="flight_search",
                request_id=request_id,
                generation_id=generation_id,
                origin=origin.title(),
                destination=destination.title(),
                date=date,
                time_constraint=time_pref,
                passengers=passengers,
                flights=matched,
                is_cancelled=False,
                is_stale=False,
                execution_time_ms=elapsed_ms,
                intent=TravelIntent(
                    intent="flight_search",
                    origin=origin.title(),
                    destination=destination.title(),
                    date=date,
                    time_constraint=time_pref,
                    passengers=passengers,
                ),
            )

        except asyncio.CancelledError:
            logger.warning(f"[{request_id}] search_flights CANCELLED (gen={generation_id})")
            raise

    @staticmethod
    async def search_hotels(
        destination: str,
        check_in_date: str = "tomorrow",
        nights: int = 2,
        budget: Optional[float] = None,
        guests: int = 1,
        sort_by: Optional[str] = None,
        location_preference: Optional[str] = None,
        generation_id: str = "gen_1",
        delay_seconds: Optional[float] = None,
    ) -> SearchHotelsResult:
        request_id = f"req_{uuid.uuid4().hex[:8]}_hotels"
        start_time = time.time()
        logger.info(
            f"[{request_id}] search_hotels: {destination}, date={check_in_date}, budget={budget}, sort={sort_by}, loc={location_preference}, gen={generation_id}"
        )

        try:
            delay = delay_seconds if delay_seconds is not None else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
            if delay > 0:
                await asyncio.sleep(delay)

            dest_lower = (destination or "").lower().strip()
            matched = []

            if dest_lower:
                for h in DEMO_HOTELS:
                    h_dest_lower = h.destination.lower()
                    if dest_lower in h_dest_lower or h_dest_lower in dest_lower or (dest_lower in ["delhi", "new delhi"] and h_dest_lower in ["delhi", "new delhi"]):
                        if budget is None or h.price_per_night <= budget:
                            matched.append(h)

                # Sorting and preference prioritization
                if sort_by in ["cheapest", "price_asc", "low_price"]:
                    matched = sorted(matched, key=lambda x: x.price_per_night)
                elif sort_by in ["rating", "rating_desc", "best"]:
                    matched = sorted(matched, key=lambda x: x.rating, reverse=True)
                elif location_preference in ["city center", "central", "center"]:
                    matched = sorted(
                        matched,
                        key=lambda x: 0 if any(w in x.location.lower() or w in [a.lower() for a in x.amenities] for w in ["central", "city center", "connaught"]) else 1,
                    )

            if not matched and destination and dest_lower not in ["unknown", "none", ""]:
                eff_price = min(budget, 4500.0) if budget else 4500.0
                matched = [
                    HotelItem(
                        hotel_id=f"hotel_{uuid.uuid4().hex[:4]}",
                        name=f"{destination.title()} Grand Heritage & Suites",
                        location=f"Central {destination.title()}",
                        destination=destination.title(),
                        rating=4.7,
                        price_per_night=eff_price,
                        price_formatted=f"₹{int(eff_price):,}",
                        amenities=["City Center", "Free Wi-Fi", "Swimming Pool", "Breakfast Included"],
                        room_type="Deluxe King Room",
                    ),
                    HotelItem(
                        hotel_id=f"hotel_{uuid.uuid4().hex[:4]}",
                        name=f"Zostel {destination.title()} Central",
                        location=f"City Center, {destination.title()}",
                        destination=destination.title(),
                        rating=4.4,
                        price_per_night=min(eff_price * 0.35, 1200.0),
                        price_formatted=f"₹{int(min(eff_price * 0.35, 1200.0)):,}",
                        amenities=["Budget Friendly", "Common Lounge", "Free Wi-Fi"],
                        room_type="Standard AC Room",
                    ),
                ]
                if sort_by in ["cheapest", "price_asc", "low_price"]:
                    matched = sorted(matched, key=lambda x: x.price_per_night)

            elapsed_ms = int((time.time() - start_time) * 1000)
            return SearchHotelsResult(
                source="demo",
                type="hotel_search",
                request_id=request_id,
                generation_id=generation_id,
                destination=destination.title() if destination else "Unknown",
                check_in_date=check_in_date,
                nights=nights,
                budget=budget,
                guests=guests,
                hotels=matched,
                is_cancelled=False,
                is_stale=False,
                execution_time_ms=elapsed_ms,
                intent=TravelIntent(
                    intent="hotel_search",
                    destination=destination.title() if destination else "Unknown",
                    date=check_in_date,
                    budget=budget,
                    guests=guests,
                ),
            )

        except asyncio.CancelledError:
            logger.warning(f"[{request_id}] search_hotels CANCELLED (gen={generation_id})")
            raise

    @staticmethod
    async def get_route_options(
        origin: str,
        destination: str,
        generation_id: str = "gen_1",
        delay_seconds: Optional[float] = None,
    ) -> RouteOptionsResult:
        request_id = f"req_{uuid.uuid4().hex[:8]}_routes"
        start_time = time.time()
        logger.info(f"[{request_id}] get_route_options: {origin} -> {destination}, gen={generation_id}")

        try:
            delay = delay_seconds if delay_seconds is not None else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
            if delay > 0:
                await asyncio.sleep(delay)

            orig_l = origin.lower()
            dest_l = destination.lower()

            if "kolkata" in orig_l and "darjeeling" in dest_l:
                routes = [
                    RouteItem(
                        mode="Flight + Scenic Taxi",
                        title="Flight to Bagdogra + 3h Hill Drive",
                        duration="04h 30m total",
                        estimated_cost="₹5,500",
                        description="1h 15m direct flight from Kolkata to Bagdogra, followed by a scenic mountain taxi ride through Kurseong.",
                        transfers=1,
                    ),
                    RouteItem(
                        mode="Overnight Train + Shared Cab",
                        title="Vande Bharat / Darjeeling Mail to NJP + Cab",
                        duration="10h 30m total",
                        estimated_cost="₹1,800",
                        description="Overnight train to New Jalpaiguri (NJP), then shared jeep or private cab up Hill Cart Road.",
                        transfers=1,
                    ),
                    RouteItem(
                        mode="Direct AC Sleeper Bus",
                        title="Overnight Volvo Bus",
                        duration="14h 00m",
                        estimated_cost="₹1,200",
                        description="Direct evening AC sleeper bus from Kolkata Esplanade to Siliguri/Darjeeling.",
                        transfers=0,
                    ),
                ]
            else:
                routes = [
                    RouteItem(
                        mode="Direct Flight",
                        title=f"Non-stop flight from {origin} to {destination}",
                        duration="02h 15m",
                        estimated_cost="₹5,000",
                        description=f"Quickest connection between {origin} and {destination}.",
                        transfers=0,
                    ),
                    RouteItem(
                        mode="Express Train",
                        title=f"Superfast / Express train to {destination}",
                        duration="12h 00m",
                        estimated_cost="₹1,500",
                        description=f"Comfortable rail option connecting major stations.",
                        transfers=0,
                    ),
                ]

            elapsed_ms = int((time.time() - start_time) * 1000)
            return RouteOptionsResult(
                source="demo",
                type="route_search",
                request_id=request_id,
                generation_id=generation_id,
                origin=origin,
                destination=destination,
                routes=routes,
                is_cancelled=False,
                is_stale=False,
                execution_time_ms=elapsed_ms,
                intent=TravelIntent(
                    intent="route_search",
                    origin=origin,
                    destination=destination,
                ),
            )

        except asyncio.CancelledError:
            logger.warning(f"[{request_id}] get_route_options CANCELLED (gen={generation_id})")
            raise

    @staticmethod
    async def get_destination_info(
        destination: str,
        category: str = "all",
        generation_id: str = "gen_1",
        delay_seconds: Optional[float] = None,
    ) -> DestinationInfoResult:
        request_id = f"req_{uuid.uuid4().hex[:8]}_dest"
        start_time = time.time()
        logger.info(f"[{request_id}] get_destination_info: {destination}, cat={category}, gen={generation_id}")

        try:
            delay = delay_seconds if delay_seconds is not None else settings.TOOL_ARTIFICIAL_DELAY_SECONDS
            if delay > 0:
                await asyncio.sleep(delay)

            dest_l = destination.lower()
            if "jaipur" in dest_l:
                best_time = "October to March (pleasant winter weather)"
                attractions = ["Amber Fort", "Hawa Mahal", "City Palace", "Jantar Mantar", "Nahargarh Fort Sunset View"]
                tips = ["Visit Amber Fort early morning to beat the crowds", "Try authentic Pyaaz Kachori and Dal Baati Churma in the old pink city"]
                overview = "Jaipur, the capital of Rajasthan, is known for its majestic palaces, historic forts, and rich royal heritage."
            elif "goa" in dest_l:
                best_time = "November to February (sunny and pleasant)"
                attractions = ["Palolem Beach", "Fort Aguada", "Basilica of Bom Jesus", "Dudhsagar Waterfalls", "Anjuna Flea Market"]
                tips = ["Rent a scooter for easy exploration", "South Goa is ideal for tranquility; North Goa for vibrant nightlife"]
                overview = "Goa is India's premier coastal haven famous for golden sandy beaches, Portuguese architecture, and fresh seafood."
            elif "sikkim" in dest_l:
                best_time = "March to May (flowering season) & October to mid-December (clear Himalayan peaks)"
                attractions = ["Tsomgo Lake", "Nathula Pass", "Rumtek Monastery", "Yumthang Valley of Flowers"]
                tips = ["Apply for protected area permits in advance for North Sikkim and Nathula", "Carry layered warm clothing"]
                overview = "Sikkim offers breathtaking views of Mt. Kanchenjunga, serene Buddhist monasteries, and pristine alpine valleys."
            else:
                best_time = "October to April"
                attractions = [f"Historic Center of {destination}", f"{destination} Scenic Viewpoint", f"Local Heritage Market of {destination}"]
                tips = ["Book attractions and hotels in advance during peak season", "Sample authentic local culinary specialties"]
                overview = f"{destination.title()} is a popular travel destination known for vibrant local culture and scenic attractions."

            elapsed_ms = int((time.time() - start_time) * 1000)
            return DestinationInfoResult(
                source="demo",
                type="destination_info",
                request_id=request_id,
                generation_id=generation_id,
                destination=destination,
                best_time_to_visit=best_time,
                top_attractions=attractions,
                local_tips=tips,
                overview=overview,
                is_cancelled=False,
                is_stale=False,
                execution_time_ms=elapsed_ms,
                intent=TravelIntent(
                    intent="destination_info",
                    destination=destination,
                ),
            )

        except asyncio.CancelledError:
            logger.warning(f"[{request_id}] get_destination_info CANCELLED (gen={generation_id})")
            raise
