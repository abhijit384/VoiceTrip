from typing import List, Optional
from pydantic import BaseModel


class TrainItem(BaseModel):
    train_number: str
    name: str
    departure: str
    arrival: str
    duration: str
    departure_time_type: str  # "morning", "afternoon", "evening", "night"
    classes: List[str]
    price: str


class SearchTrainsRequest(BaseModel):
    origin: str
    destination: str
    date: str
    time_constraint: Optional[str] = "any"
    session_id: Optional[str] = "default"
    generation_id: Optional[str] = "gen_1"


class SearchTrainsResult(BaseModel):
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
