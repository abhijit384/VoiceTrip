import uuid
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from livekit.api import AccessToken, VideoGrants
from app.core.config import settings

logger = logging.getLogger("livekit-token")
router = APIRouter(prefix="/livekit", tags=["LiveKit"])


class TokenRequest(BaseModel):
    room_name: Optional[str] = "voicetrip-room"
    participant_name: Optional[str] = None


class TokenResponse(BaseModel):
    token: str
    url: Optional[str]
    room_name: str
    participant_identity: str
    is_livekit_configured: bool


@router.post("/token", response_model=TokenResponse)
async def generate_livekit_token(payload: TokenRequest = TokenRequest()):
    """
    Generate an ephemeral JWT token for joining a LiveKit audio room.
    Protects secrets on the backend and signs participant grants.
    Falls back cleanly if cloud credentials are not yet configured.
    """
    identity = f"user_{uuid.uuid4().hex[:8]}"
    room_name = payload.room_name or "voicetrip-room"
    name = payload.participant_name or "Traveler"

    api_key = settings.LIVEKIT_API_KEY
    api_secret = settings.LIVEKIT_API_SECRET
    livekit_url = settings.LIVEKIT_URL

    is_configured = bool(api_key and api_secret and livekit_url and "your-livekit-project" not in livekit_url)

    if is_configured:
        try:
            grant = VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            )
            token = (
                AccessToken(api_key=api_key, api_secret=api_secret)
                .with_identity(identity)
                .with_name(name)
                .with_grants(grant)
                .to_jwt()
            )
            logger.info(f"Generated LiveKit token for participant {identity} in room {room_name}")
            return TokenResponse(
                token=token,
                url=livekit_url,
                room_name=room_name,
                participant_identity=identity,
                is_livekit_configured=True,
            )
        except Exception as e:
            logger.error(f"Error generating LiveKit token: {e}")
            raise HTTPException(status_code=500, detail="Failed to create LiveKit token")
    else:
        # Graceful development mode: generate a signed dummy JWT so the client has a valid payload
        dev_key = api_key or "devkey"
        dev_secret = api_secret or "devsecret_32_characters_long_min_pad!"
        grant = VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
        )
        token = (
            AccessToken(api_key=dev_key, api_secret=dev_secret)
            .with_identity(identity)
            .with_name(name)
            .with_grants(grant)
            .to_jwt()
        )
        logger.info(f"LiveKit Cloud credentials not provided; generated local dev token for {identity}")
        return TokenResponse(
            token=token,
            url=livekit_url or "wss://local-mock.livekit.cloud",
            room_name=room_name,
            participant_identity=identity,
            is_livekit_configured=False,
        )


@router.get("/token", response_model=TokenResponse)
async def get_livekit_token(
    room_name: str = "voicetrip-room",
    participant_name: Optional[str] = "Traveler",
):
    """GET convenience wrapper for generating LiveKit token."""
    return await generate_livekit_token(
        TokenRequest(room_name=room_name, participant_name=participant_name)
    )
